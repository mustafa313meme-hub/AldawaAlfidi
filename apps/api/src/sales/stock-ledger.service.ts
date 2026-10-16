import { Global, Injectable, Module } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { AppException } from '../common/app.exception';
import { localDate } from '../common/perm';
import { Alloc, planFefo, weightedAverageCost } from '../inventory/allocation';

type Tx = Prisma.TransactionClient;

export interface MovementRow {
  warehouseId: string;
  productId: string;
  movementType: MovementType;
  quantity: number;
  isBonus?: boolean;
  unitCost?: number | null;
  batchNumber?: string | null;
  expiryDate?: Date | null;
  referenceType: string;
  referenceId: string;
  createdById?: string | null;
  note?: string;
}

/**
 * All physical stock goes through here. Invariants (checked by GET /inventory/reconcile):
 *  - Stock.quantity = SUM(signed stock movements)
 *  - SUM(batch quantities) <= Stock.quantity   (the rest is "unbatched" opening/legacy stock)
 * Every operation first takes a row lock on (warehouse, product) so concurrent sales/transfers/receipts
 * of the same product are serialised; locks are taken in a fixed order by the callers to avoid deadlocks.
 */
@Injectable()
export class StockService {
  today(): Date {
    return new Date(localDate(new Date()));
  }

  async lock(tx: Tx, warehouseId: string, productId: string) {
    await tx.stock.upsert({ where: { warehouseId_productId: { warehouseId, productId } }, update: {}, create: { warehouseId, productId, quantity: 0 } });
    await tx.$queryRaw`SELECT 1 FROM stock WHERE "warehouseId" = ${warehouseId} AND "productId" = ${productId} FOR UPDATE`;
  }

  /** Take units for a sale/transfer/write-off: FEFO over sellable batches, then unbatched stock. Returns where they came from. */
  async takeFefo(tx: Tx, warehouseId: string, productId: string, qty: number, opts: { allowExpired?: boolean } = {}): Promise<Alloc[]> {
    if (qty <= 0) return [];
    await this.lock(tx, warehouseId, productId);
    const stock = await tx.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId } } });
    const batches = await tx.stockBatch.findMany({ where: { warehouseId, productId, quantity: { gt: 0 } }, orderBy: { createdAt: 'asc' } });
    let plan;
    try {
      plan = planFefo(batches.map((b) => ({ id: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, quantity: b.quantity, cost: b.cost })), stock.quantity, qty, this.today(), opts.allowExpired);
    } catch {
      throw new AppException('STOCK_INCONSISTENT', 'بيانات المخزون غير متسقة؛ شغّل /inventory/reconcile', 500, { productId, warehouseId });
    }
    if (!plan.ok) {
      throw new AppException('INSUFFICIENT_STOCK', 'الكمية الصالحة للبيع في المخزن غير كافية', 409, {
        productId, requested: qty, onHand: stock.quantity, sellable: plan.sellable, expiredQuantity: plan.expired,
      });
    }
    for (const a of plan.allocs) {
      if (a.batchId) await tx.stockBatch.update({ where: { id: a.batchId }, data: { quantity: { decrement: a.qty } } });
      if (!a.batchId) a.unitCost = stock.averageCost;
    }
    await tx.stock.update({ where: { warehouseId_productId: { warehouseId, productId } }, data: { quantity: { decrement: qty } } });
    return plan.allocs;
  }

  /** Take from one specific batch (transfers, write-offs). batchId null = the unbatched part. */
  async takeFromBatch(tx: Tx, warehouseId: string, productId: string, batchId: string | null, qty: number): Promise<Alloc> {
    await this.lock(tx, warehouseId, productId);
    const stock = await tx.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId, productId } } });
    if (batchId) {
      const b = await tx.stockBatch.findFirst({ where: { id: batchId, warehouseId, productId } });
      if (!b) throw new AppException('INVALID_BATCH', 'التشغيلة غير موجودة في هذا المخزن لهذا المنتج', 400, { batchId });
      if (b.quantity < qty) throw new AppException('INSUFFICIENT_STOCK', 'كمية التشغيلة غير كافية', 409, { batchId, available: b.quantity, requested: qty });
      await tx.stockBatch.update({ where: { id: b.id }, data: { quantity: { decrement: qty } } });
      await tx.stock.update({ where: { warehouseId_productId: { warehouseId, productId } }, data: { quantity: { decrement: qty } } });
      return { batchId: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, unitCost: b.cost, qty };
    }
    const agg = await tx.stockBatch.aggregate({ where: { warehouseId, productId }, _sum: { quantity: true } });
    const unbatched = stock.quantity - (agg._sum.quantity ?? 0);
    if (unbatched < qty) throw new AppException('INSUFFICIENT_STOCK', 'الكمية غير المرتبطة بتشغيلة غير كافية؛ حدّد التشغيلة', 409, { available: unbatched, requested: qty });
    await tx.stock.update({ where: { warehouseId_productId: { warehouseId, productId } }, data: { quantity: { decrement: qty } } });
    return { batchId: null, batchNumber: null, expiryDate: null, unitCost: stock.averageCost, qty };
  }

  /**
   * Put units into stock, into a batch (created if new) or unbatched. `totalCost` is what these units cost in total
   * (0 for free goods); the weighted average cost of the product in this warehouse is updated.
   */
  async receive(tx: Tx, p: { warehouseId: string; productId: string; qty: number; totalCost: number; batchNumber?: string | null; expiryDate?: Date | null; sourcePurchaseId?: string | null; updateCost?: boolean }) {
    await this.lock(tx, p.warehouseId, p.productId);
    const stock = await tx.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: p.warehouseId, productId: p.productId } } });
    const unitCost = p.qty > 0 ? Number((BigInt(p.totalCost) * 2n + BigInt(p.qty)) / (2n * BigInt(p.qty))) : 0;
    let batchId: string | null = null;

    if (p.batchNumber) {
      const existing = await tx.stockBatch.findUnique({ where: { warehouseId_productId_batchNumber: { warehouseId: p.warehouseId, productId: p.productId, batchNumber: p.batchNumber } } });
      if (existing) {
        const sameExpiry = (existing.expiryDate?.getTime() ?? null) === (p.expiryDate?.getTime() ?? null);
        if (!sameExpiry) throw new AppException('BATCH_EXPIRY_MISMATCH', 'رقم التشغيلة موجود بتاريخ انتهاء مختلف', 409, { batchNumber: p.batchNumber });
        const newCost = weightedAverageCost(existing.quantity, existing.cost, p.qty, p.totalCost);
        await tx.stockBatch.update({ where: { id: existing.id }, data: { quantity: { increment: p.qty }, cost: newCost } });
        batchId = existing.id;
      } else {
        const b = await tx.stockBatch.create({
          data: { warehouseId: p.warehouseId, productId: p.productId, batchNumber: p.batchNumber, expiryDate: p.expiryDate ?? null, quantity: p.qty, cost: unitCost, sourcePurchaseId: p.sourcePurchaseId ?? null },
        });
        batchId = b.id;
      }
    }

    const update = p.updateCost === false
      ? { quantity: { increment: p.qty } }
      : { quantity: { increment: p.qty }, averageCost: weightedAverageCost(stock.quantity, stock.averageCost, p.qty, p.totalCost), lastCost: unitCost };
    await tx.stock.update({ where: { warehouseId_productId: { warehouseId: p.warehouseId, productId: p.productId } }, data: update });
    return { batchId, unitCost };
  }

  /** Put units back (returns, cancellations). batchId null = unbatched. Costs are untouched. */
  async restore(tx: Tx, warehouseId: string, productId: string, batchId: string | null, qty: number) {
    if (qty <= 0) return;
    await this.lock(tx, warehouseId, productId);
    if (batchId) await tx.stockBatch.update({ where: { id: batchId }, data: { quantity: { increment: qty } } });
    await tx.stock.update({ where: { warehouseId_productId: { warehouseId, productId } }, data: { quantity: { increment: qty } } });
  }

  /** Every stock change is paired with one of these (SRS §19). */
  movements(tx: Tx, rows: MovementRow[]) {
    const data = rows.filter((r) => r.quantity > 0).map((r) => ({ ...r, isBonus: r.isBonus ?? false }));
    return data.length ? tx.stockMovement.createMany({ data }) : Promise.resolve({ count: 0 });
  }
}

@Injectable()
export class LedgerService {
  /** Serialises everything that changes one customer's balance (credit check + invoice, returns...). */
  async lockCustomer(tx: Tx, customerId: string) {
    await tx.$queryRaw`SELECT id FROM customers WHERE id = ${customerId} FOR UPDATE`;
  }

  async lockInvoice(tx: Tx, invoiceId: string) {
    await tx.$queryRaw`SELECT id FROM invoices WHERE id = ${invoiceId} FOR UPDATE`;
  }

  async balance(tx: Tx, customerId: string): Promise<number> {
    const [c, agg] = await Promise.all([
      tx.customer.findUniqueOrThrow({ where: { id: customerId }, select: { openingBalance: true } }),
      tx.ledgerEntry.aggregate({ where: { customerId }, _sum: { debit: true, credit: true } }),
    ]);
    return c.openingBalance + (agg._sum.debit ?? 0) - (agg._sum.credit ?? 0);
  }

  add(tx: Tx, e: { customerId: string; entryType: 'Invoice' | 'Return' | 'Payment' | 'Adjustment' | 'Cancellation'; debit?: number; credit?: number; referenceType: string; referenceId: string; description?: string; createdById?: string | null }) {
    return tx.ledgerEntry.create({ data: { ...e, debit: e.debit ?? 0, credit: e.credit ?? 0 } });
  }
}

@Global()
@Module({ providers: [StockService, LedgerService], exports: [StockService, LedgerService] })
export class StockModule {}

import { Injectable } from '@nestjs/common';
import { MovementType, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../sequence/sequence.service';
import { AppException } from '../common/app.exception';
import { AuthUser, ReqCtx } from '../common/decorators';
import { can } from '../common/perm';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { mulDivRound } from '../sales/money';
import { MovementRow, StockService } from '../sales/stock-ledger.service';
import { Alloc } from './allocation';
import { BatchesQuery, CreateAdjustmentDto, CreatePurchaseDto, CreateTransferDto, ListQuery, PurchasesQuery, ReceivePurchaseDto, StocktakeDto, UpdatePurchaseDto } from './inventory.dto';

type Tx = Prisma.TransactionClient;
const day = (s: string) => new Date(s.slice(0, 10));
const pad = (n: number, w = 6) => String(n).padStart(w, '0');
const PURCHASE_INCLUDE = { items: { include: { product: { select: { id: true, sku: true, nameAr: true } } } }, company: { select: { id: true, name: true } }, warehouse: { select: { id: true, name: true } } } as const;

@Injectable()
export class InventoryService {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private stock: StockService) {}

  // ───────────── Purchases ─────────────

  private async priceItems(tx: Tx, companyId: string, items: CreatePurchaseDto['items']) {
    const ids = items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw new AppException('DUPLICATE_PRODUCT', 'منتج مكرر في أمر الشراء', 400);
    const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, companyId: true, isActive: true } });
    const byId = new Map(products.map((p) => [p.id, p]));
    const bad = ids.filter((i) => { const p = byId.get(i); return !p || !p.isActive || p.companyId !== companyId; });
    if (bad.length) throw new AppException('INVALID_PRODUCT', 'منتج غير موجود أو غير فعّال أو لا يتبع هذه الشركة', 400, bad);
    const rows = items.map((i) => {
      const gross = i.quantity * i.unitCost;
      const discount = i.discountAmount ?? 0;
      if (!Number.isSafeInteger(gross) || discount > gross) throw new AppException('INVALID_LINE', 'الخصم يتجاوز قيمة السطر', 400, { productId: i.productId });
      return { productId: i.productId, quantity: i.quantity, bonusQuantity: i.bonusQuantity ?? 0, unitCost: i.unitCost, discountAmount: discount, lineTotal: gross - discount, gross };
    });
    return {
      rows: rows.map(({ gross: _g, ...r }) => r),
      subtotal: rows.reduce((s, r) => s + r.gross, 0),
      discountTotal: rows.reduce((s, r) => s + r.discountAmount, 0),
      total: rows.reduce((s, r) => s + r.lineTotal, 0),
    };
  }

  async createPurchase(dto: CreatePurchaseDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const [company, wh] = await Promise.all([tx.company.findUnique({ where: { id: dto.companyId } }), tx.warehouse.findUnique({ where: { id: dto.warehouseId } })]);
      if (!company || !company.isActive) throw new AppException('INVALID_COMPANY', 'الشركة غير موجودة أو غير فعّالة', 400);
      if (!wh || !wh.isActive) throw new AppException('INVALID_WAREHOUSE', 'المخزن غير موجود أو غير فعّال', 400);
      const priced = await this.priceItems(tx, dto.companyId, dto.items);
      const orderNumber = `PO-${pad(await this.seq.next('purchase', tx))}`;
      const po = await tx.purchaseOrder.create({
        data: { orderNumber, companyId: dto.companyId, warehouseId: dto.warehouseId, notes: dto.notes, subtotal: priced.subtotal, discountTotal: priced.discountTotal, total: priced.total, createdById: u.id, items: { create: priced.rows } },
        include: PURCHASE_INCLUDE,
      });
      await this.audit.log({ userId: u.id, action: 'purchases.create', entity: 'purchase', entityId: po.id, newValues: { orderNumber, total: po.total, items: priced.rows }, ctx }, tx);
      return po;
    });
  }

  async updatePurchase(id: string, dto: UpdatePurchaseDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!before) throw new AppException('NOT_FOUND', 'أمر الشراء غير موجود', 404);
      if (before.status !== 'Draft') throw new AppException('PURCHASE_LOCKED', 'التعديل متاح للمسودة فقط', 409, { status: before.status });
      const data: Prisma.PurchaseOrderUncheckedUpdateInput = { notes: dto.notes, warehouseId: dto.warehouseId };
      if (dto.warehouseId) {
        const w = await tx.warehouse.findUnique({ where: { id: dto.warehouseId } });
        if (!w || !w.isActive) throw new AppException('INVALID_WAREHOUSE', 'المخزن غير موجود أو غير فعّال', 400);
      }
      if (dto.items) {
        const priced = await this.priceItems(tx, before.companyId, dto.items);
        await tx.purchaseOrderItem.deleteMany({ where: { purchaseOrderId: id } });
        await tx.purchaseOrderItem.createMany({ data: priced.rows.map((r) => ({ ...r, purchaseOrderId: id })) });
        Object.assign(data, { subtotal: priced.subtotal, discountTotal: priced.discountTotal, total: priced.total });
      }
      const after = await tx.purchaseOrder.update({ where: { id }, data, include: PURCHASE_INCLUDE });
      await this.audit.log({ userId: u.id, action: 'purchases.update', entity: 'purchase', entityId: id, oldValues: { total: before.total, items: before.items }, newValues: { total: after.total, items: after.items }, ctx }, tx);
      return after;
    });
  }

  async listPurchases(q: PurchasesQuery) {
    const where: Prisma.PurchaseOrderWhereInput = { status: q.status, companyId: q.companyId, warehouseId: q.warehouseId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.purchaseOrder.findMany({ where, include: { company: PURCHASE_INCLUDE.company, warehouse: PURCHASE_INCLUDE.warehouse }, orderBy: { orderDate: q.order }, ...skipTake(q) }),
      this.prisma.purchaseOrder.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async getPurchase(id: string) {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id }, include: PURCHASE_INCLUDE });
    if (!po) throw new AppException('NOT_FOUND', 'أمر الشراء غير موجود', 404);
    return po;
  }

  private async movePurchase(id: string, from: ('Draft' | 'Ordered')[], to: 'Ordered' | 'Cancelled', action: string, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const r = await tx.purchaseOrder.updateMany({ where: { id, status: { in: from } }, data: { status: to } });
      if (r.count !== 1) {
        const cur = await tx.purchaseOrder.findUnique({ where: { id } });
        if (!cur) throw new AppException('NOT_FOUND', 'أمر الشراء غير موجود', 404);
        throw new AppException('INVALID_TRANSITION', `لا يمكن نقل أمر الشراء من ${cur.status} إلى ${to}`, 409);
      }
      await this.audit.log({ userId: u.id, action, entity: 'purchase', entityId: id, newValues: { status: to }, ctx }, tx);
      return { id, status: to };
    });
  }
  markOrdered(id: string, u: AuthUser, ctx: ReqCtx) { return this.movePurchase(id, ['Draft'], 'Ordered', 'purchases.ordered', u, ctx); }
  cancelPurchase(id: string, u: AuthUser, ctx: ReqCtx) { return this.movePurchase(id, ['Draft', 'Ordered'], 'Cancelled', 'purchases.cancel', u, ctx); }

  /**
   * Goods receipt: creates/increments batches, raises stock, updates the weighted-average cost, writes `Purchase` movements.
   * One transaction; the status claim makes a double receipt impossible. Free (bonus) goods enter at zero cost.
   */
  receivePurchase(id: string, dto: ReceivePurchaseDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const po = await tx.purchaseOrder.findUnique({ where: { id }, include: { items: true } });
      if (!po) throw new AppException('NOT_FOUND', 'أمر الشراء غير موجود', 404);
      const claimed = await tx.purchaseOrder.updateMany({ where: { id, status: { in: ['Draft', 'Ordered'] } }, data: { status: 'Received', receivedAt: new Date(), receivedById: u.id } });
      if (claimed.count !== 1) throw new AppException('INVALID_TRANSITION', 'تم استلام أمر الشراء أو إلغاؤه مسبقاً', 409, { status: po.status });

      const byItem = new Map(po.items.map((i) => [i.id, i]));
      const sums = new Map<string, { q: number; b: number }>();
      for (const l of dto.lines) {
        if (!byItem.has(l.itemId)) throw new AppException('INVALID_ITEM', 'سطر غير تابع لأمر الشراء', 400, { itemId: l.itemId });
        const s = sums.get(l.itemId) ?? { q: 0, b: 0 };
        s.q += l.quantity;
        s.b += l.bonusQuantity ?? 0;
        sums.set(l.itemId, s);
      }
      const mismatch = po.items.filter((i) => { const s = sums.get(i.id); return !s || s.q !== i.quantity || s.b !== i.bonusQuantity; })
        .map((i) => ({ itemId: i.id, ordered: i.quantity, orderedBonus: i.bonusQuantity, received: sums.get(i.id)?.q ?? 0, receivedBonus: sums.get(i.id)?.b ?? 0 }));
      if (mismatch.length) throw new AppException('RECEIPT_MISMATCH', 'كميات الاستلام يجب أن تطابق أمر الشراء لكل صنف (الدفعات الجزئية غير مدعومة)', 422, mismatch);

      const today = this.stock.today();
      const paidSoFar = new Map<string, number>();
      const moves: MovementRow[] = [];
      const lines = [...dto.lines].sort((a, b) => byItem.get(a.itemId)!.productId.localeCompare(byItem.get(b.itemId)!.productId) || a.batchNumber.localeCompare(b.batchNumber));
      for (const l of lines) {
        const item = byItem.get(l.itemId)!;
        const expiry = l.expiryDate ? day(l.expiryDate) : null;
        if (expiry && expiry < today) throw new AppException('EXPIRED_BATCH', 'لا يمكن استلام تشغيلة منتهية الصلاحية', 422, { batchNumber: l.batchNumber });
        const bonus = l.bonusQuantity ?? 0;
        const before = paidSoFar.get(l.itemId) ?? 0;
        // telescoping split of the line's cost across batches: the pieces add up to exactly lineTotal
        const cost = mulDivRound(item.lineTotal, before + l.quantity, item.quantity) - mulDivRound(item.lineTotal, before, item.quantity);
        paidSoFar.set(l.itemId, before + l.quantity);
        const r = await this.stock.receive(tx, { warehouseId: po.warehouseId, productId: item.productId, qty: l.quantity + bonus, totalCost: cost, batchNumber: l.batchNumber, expiryDate: expiry, sourcePurchaseId: po.id });
        const base = { warehouseId: po.warehouseId, productId: item.productId, movementType: 'Purchase' as const, batchNumber: l.batchNumber, expiryDate: expiry, referenceType: 'Purchase', referenceId: po.id, createdById: u.id };
        moves.push({ ...base, quantity: l.quantity, unitCost: l.quantity ? Math.round(cost / l.quantity) : r.unitCost }, { ...base, quantity: bonus, isBonus: true, unitCost: 0 });
      }
      await this.stock.movements(tx, moves);
      await this.audit.log({ userId: u.id, action: 'purchases.receive', entity: 'purchase', entityId: id, newValues: { orderNumber: po.orderNumber, total: po.total, lines: dto.lines }, ctx }, tx);
      return tx.purchaseOrder.findUniqueOrThrow({ where: { id }, include: PURCHASE_INCLUDE });
    }, { timeout: 30_000 });
  }

  // ───────────── Transfers (immediate, one step) ─────────────

  createTransfer(dto: CreateTransferDto, u: AuthUser, ctx: ReqCtx) {
    if (dto.fromWarehouseId === dto.toWarehouseId) throw new AppException('SAME_WAREHOUSE', 'المخزن المصدر والهدف متطابقان', 400);
    const ids = dto.items.map((i) => `${i.productId}:${i.batchId ?? ''}`);
    if (new Set(ids).size !== ids.length) throw new AppException('DUPLICATE_ITEMS', 'سطر مكرر في التحويل', 400);
    return this.prisma.$transaction(async (tx) => {
      const whs = await tx.warehouse.findMany({ where: { id: { in: [dto.fromWarehouseId, dto.toWarehouseId] } } });
      if (whs.length !== 2 || whs.some((w) => !w.isActive)) throw new AppException('INVALID_WAREHOUSE', 'مخزن غير موجود أو غير فعّال', 400);
      const transferNumber = `TRF-${pad(await this.seq.next('transfer', tx))}`;
      const t = await tx.stockTransfer.create({ data: { transferNumber, fromWarehouseId: dto.fromWarehouseId, toWarehouseId: dto.toWarehouseId, notes: dto.notes, createdById: u.id } });

      const moves: MovementRow[] = [];
      const itemRows: Prisma.StockTransferItemCreateManyInput[] = [];
      const [w1, w2] = [dto.fromWarehouseId, dto.toWarehouseId].sort();
      for (const it of [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        // lock both sides in a fixed order so opposite transfers can never deadlock
        await this.stock.lock(tx, w1, it.productId);
        await this.stock.lock(tx, w2, it.productId);
        const allocs: Alloc[] = it.batchId
          ? [await this.stock.takeFromBatch(tx, dto.fromWarehouseId, it.productId, it.batchId, it.quantity)]
          : await this.stock.takeFefo(tx, dto.fromWarehouseId, it.productId, it.quantity);
        for (const a of allocs) {
          await this.stock.receive(tx, { warehouseId: dto.toWarehouseId, productId: it.productId, qty: a.qty, totalCost: a.unitCost * a.qty, batchNumber: a.batchNumber, expiryDate: a.expiryDate });
          const common = { productId: it.productId, unitCost: a.unitCost, batchNumber: a.batchNumber, expiryDate: a.expiryDate, quantity: a.qty, referenceType: 'Transfer', referenceId: t.id, createdById: u.id };
          moves.push({ ...common, warehouseId: dto.fromWarehouseId, movementType: 'TransferOut' }, { ...common, warehouseId: dto.toWarehouseId, movementType: 'TransferIn' });
          itemRows.push({ transferId: t.id, productId: it.productId, batchNumber: a.batchNumber, expiryDate: a.expiryDate, quantity: a.qty });
        }
      }
      await tx.stockTransferItem.createMany({ data: itemRows });
      await this.stock.movements(tx, moves);
      await this.audit.log({ userId: u.id, action: 'transfers.create', entity: 'transfer', entityId: t.id, newValues: { transferNumber, from: dto.fromWarehouseId, to: dto.toWarehouseId, items: itemRows }, ctx }, tx);
      return tx.stockTransfer.findUniqueOrThrow({ where: { id: t.id }, include: { items: true } });
    }, { timeout: 30_000 });
  }

  async listTransfers(q: ListQuery) {
    const where: Prisma.StockTransferWhereInput = q.warehouseId ? { OR: [{ fromWarehouseId: q.warehouseId }, { toWarehouseId: q.warehouseId }] } : {};
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockTransfer.findMany({ where, include: { fromWarehouse: { select: { id: true, name: true } }, toWarehouse: { select: { id: true, name: true } } }, orderBy: { createdAt: q.order }, ...skipTake(q) }),
      this.prisma.stockTransfer.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async getTransfer(id: string) {
    const t = await this.prisma.stockTransfer.findUnique({ where: { id }, include: { items: true, fromWarehouse: { select: { id: true, name: true } }, toWarehouse: { select: { id: true, name: true } } } });
    if (!t) throw new AppException('NOT_FOUND', 'التحويل غير موجود', 404);
    return t;
  }

  // ───────────── Adjustments & stocktake ─────────────

  private moveTypeForDecrease(reason: string): MovementType {
    return reason === 'Damage' ? 'Damage' : reason === 'Expired' ? 'Expired' : 'AdjustmentOut';
  }

  /** Apply one signed quantity change; returns the item rows and movements describing what really happened. */
  private async applyDelta(tx: Tx, warehouseId: string, productId: string, batchId: string | null, delta: number, reason: string, adjustmentId: string, userId: string, systemQuantity?: number) {
    const items: Prisma.StockAdjustmentItemCreateManyInput[] = [];
    const moves: MovementRow[] = [];
    if (delta > 0) {
      let batchNumber: string | null = null;
      let expiryDate: Date | null = null;
      if (batchId) {
        const b = await tx.stockBatch.findFirst({ where: { id: batchId, warehouseId, productId } });
        if (!b) throw new AppException('INVALID_BATCH', 'التشغيلة غير موجودة في هذا المخزن لهذا المنتج', 400, { batchId });
        batchNumber = b.batchNumber;
        expiryDate = b.expiryDate;
      }
      await this.stock.restore(tx, warehouseId, productId, batchId, delta);
      items.push({ adjustmentId, productId, batchNumber, quantityDelta: delta, systemQuantity });
      moves.push({ warehouseId, productId, movementType: 'AdjustmentIn', quantity: delta, batchNumber, expiryDate, referenceType: 'Adjustment', referenceId: adjustmentId, createdById: userId });
    } else {
      const qty = -delta;
      const allocs = batchId ? [await this.stock.takeFromBatch(tx, warehouseId, productId, batchId, qty)] : await this.stock.takeFefo(tx, warehouseId, productId, qty, { allowExpired: reason === 'Expired' });
      for (const a of allocs) {
        items.push({ adjustmentId, productId, batchNumber: a.batchNumber, quantityDelta: -a.qty, systemQuantity });
        moves.push({ warehouseId, productId, movementType: this.moveTypeForDecrease(reason), quantity: a.qty, unitCost: a.unitCost, batchNumber: a.batchNumber, expiryDate: a.expiryDate, referenceType: 'Adjustment', referenceId: adjustmentId, createdById: userId });
      }
    }
    return { items, moves };
  }

  createAdjustment(dto: CreateAdjustmentDto, u: AuthUser, ctx: ReqCtx) {
    if (dto.items.some((i) => i.quantityDelta === 0)) throw new AppException('INVALID_QUANTITY', 'الفرق لا يمكن أن يكون صفراً', 400);
    return this.prisma.$transaction(async (tx) => {
      const wh = await tx.warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!wh || !wh.isActive) throw new AppException('INVALID_WAREHOUSE', 'المخزن غير موجود أو غير فعّال', 400);
      const products = await tx.product.count({ where: { id: { in: dto.items.map((i) => i.productId) } } });
      if (products !== new Set(dto.items.map((i) => i.productId)).size) throw new AppException('INVALID_PRODUCT', 'منتج غير موجود', 400);
      const adjustmentNumber = `ADJ-${pad(await this.seq.next('adjustment', tx))}`;
      const adj = await tx.stockAdjustment.create({ data: { adjustmentNumber, warehouseId: dto.warehouseId, reason: dto.reason, notes: dto.notes, createdById: u.id } });
      const allItems: Prisma.StockAdjustmentItemCreateManyInput[] = [];
      const allMoves: MovementRow[] = [];
      for (const it of [...dto.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const r = await this.applyDelta(tx, dto.warehouseId, it.productId, it.batchId ?? null, it.quantityDelta, dto.reason, adj.id, u.id);
        allItems.push(...r.items);
        allMoves.push(...r.moves);
      }
      await tx.stockAdjustmentItem.createMany({ data: allItems });
      await this.stock.movements(tx, allMoves);
      await this.audit.log({ userId: u.id, action: 'adjustments.create', entity: 'adjustment', entityId: adj.id, newValues: { adjustmentNumber, reason: dto.reason, notes: dto.notes, items: allItems }, ctx }, tx);
      return tx.stockAdjustment.findUniqueOrThrow({ where: { id: adj.id }, include: { items: true } });
    }, { timeout: 30_000 });
  }

  stocktake(dto: StocktakeDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const wh = await tx.warehouse.findUnique({ where: { id: dto.warehouseId } });
      if (!wh || !wh.isActive) throw new AppException('INVALID_WAREHOUSE', 'المخزن غير موجود أو غير فعّال', 400);
      const keys = dto.counts.map((c) => `${c.productId}:${c.batchId ?? ''}`);
      if (new Set(keys).size !== keys.length) throw new AppException('DUPLICATE_ITEMS', 'سطر جرد مكرر', 400);

      const adjustmentNumber = `ADJ-${pad(await this.seq.next('adjustment', tx))}`;
      const adj = await tx.stockAdjustment.create({ data: { adjustmentNumber, warehouseId: dto.warehouseId, reason: 'Stocktake', notes: dto.notes, createdById: u.id } });
      const allItems: Prisma.StockAdjustmentItemCreateManyInput[] = [];
      const allMoves: MovementRow[] = [];
      const report: { productId: string; batchId: string | null; system: number; counted: number; difference: number }[] = [];

      for (const c of [...dto.counts].sort((a, b) => a.productId.localeCompare(b.productId))) {
        await this.stock.lock(tx, dto.warehouseId, c.productId);
        // system quantity: the batch's, or (without a batch) the part of the stock that is not in any batch
        let system: number;
        if (c.batchId) {
          const b = await tx.stockBatch.findFirst({ where: { id: c.batchId, warehouseId: dto.warehouseId, productId: c.productId } });
          if (!b) throw new AppException('INVALID_BATCH', 'التشغيلة غير موجودة في هذا المخزن لهذا المنتج', 400, { batchId: c.batchId });
          system = b.quantity;
        } else {
          const [st, agg] = await Promise.all([
            tx.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: c.productId } } }),
            tx.stockBatch.aggregate({ where: { warehouseId: dto.warehouseId, productId: c.productId }, _sum: { quantity: true } }),
          ]);
          system = st.quantity - (agg._sum.quantity ?? 0);
        }
        const diff = c.countedQuantity - system;
        report.push({ productId: c.productId, batchId: c.batchId ?? null, system, counted: c.countedQuantity, difference: diff });
        if (diff === 0) continue;
        const r = await this.applyDelta(tx, dto.warehouseId, c.productId, c.batchId ?? null, diff, 'Stocktake', adj.id, u.id, system);
        allItems.push(...r.items);
        allMoves.push(...r.moves);
      }
      if (!allItems.length) {
        await tx.stockAdjustment.delete({ where: { id: adj.id } }); // nothing differed: no document (the number is simply skipped)
        return { adjusted: 0, adjustmentId: null, report };
      }
      await tx.stockAdjustmentItem.createMany({ data: allItems });
      await this.stock.movements(tx, allMoves);
      await this.audit.log({ userId: u.id, action: 'adjustments.stocktake', entity: 'adjustment', entityId: adj.id, newValues: { adjustmentNumber, report: report.filter((r) => r.difference !== 0) }, ctx }, tx);
      return { adjusted: allItems.length, adjustmentId: adj.id, adjustmentNumber, report };
    }, { timeout: 60_000 });
  }

  async listAdjustments(q: ListQuery) {
    const where: Prisma.StockAdjustmentWhereInput = { warehouseId: q.warehouseId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockAdjustment.findMany({ where, orderBy: { createdAt: q.order }, ...skipTake(q) }),
      this.prisma.stockAdjustment.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async getAdjustment(id: string) {
    const a = await this.prisma.stockAdjustment.findUnique({ where: { id }, include: { items: true } });
    if (!a) throw new AppException('NOT_FOUND', 'التسوية غير موجودة', 404);
    return a;
  }

  // ───────────── Batch reports ─────────────

  async batches(q: BatchesQuery, u: AuthUser, forced?: 'near' | 'expired') {
    const today = this.stock.today();
    const status = forced ?? q.status ?? 'all';
    const days = q.days ?? 90;
    const limit = new Date(today.getTime() + days * 86_400_000);
    const where: Prisma.StockBatchWhereInput = {
      warehouseId: q.warehouseId, productId: q.productId,
      quantity: q.includeEmpty ? undefined : { gt: 0 },
      ...(status === 'expired' ? { expiryDate: { lt: today } } : status === 'near' ? { expiryDate: { gte: today, lte: limit } } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.stockBatch.findMany({
        where, orderBy: [{ expiryDate: { sort: 'asc', nulls: 'last' } }, { batchNumber: 'asc' }], ...skipTake(q),
        include: { product: { select: { id: true, sku: true, nameAr: true } }, warehouse: { select: { id: true, name: true } } },
      }),
      this.prisma.stockBatch.count({ where }),
    ]);
    const seeCost = can(u, 'products.view_cost');
    const items = rows.map((b) => ({
      id: b.id, product: b.product, warehouse: b.warehouse, batchNumber: b.batchNumber, expiryDate: b.expiryDate, quantity: b.quantity,
      daysToExpiry: b.expiryDate ? Math.round((b.expiryDate.getTime() - today.getTime()) / 86_400_000) : null,
      expired: !!b.expiryDate && b.expiryDate < today,
      ...(seeCost ? { cost: b.cost, value: b.cost * b.quantity } : {}),
    }));
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  /**
   * Integrity check for the inventory books. Run it after go-live testing and on a schedule:
   *   - Stock.quantity must equal the sum of signed movements
   *   - batch quantities must never exceed Stock.quantity
   * An empty result means the books are consistent.
   */
  async reconcile() {
    const rows = await this.prisma.$queryRaw<{ warehouseId: string; productId: string; stock: bigint; movements: bigint; batches: bigint }[]>`
      WITH mv AS (
        SELECT "warehouseId", "productId",
               SUM(CASE WHEN "movementType" IN ('Purchase','ReturnIn','TransferIn','AdjustmentIn','OpeningBalance') THEN quantity ELSE -quantity END)::bigint AS net
        FROM stock_movements GROUP BY 1, 2),
      bt AS (SELECT "warehouseId", "productId", SUM(quantity)::bigint AS q FROM stock_batches GROUP BY 1, 2)
      SELECT COALESCE(s."warehouseId", mv."warehouseId") AS "warehouseId", COALESCE(s."productId", mv."productId") AS "productId",
             COALESCE(s.quantity, 0)::bigint AS stock, COALESCE(mv.net, 0)::bigint AS movements, COALESCE(bt.q, 0)::bigint AS batches
      FROM stock s
      FULL OUTER JOIN mv ON mv."warehouseId" = s."warehouseId" AND mv."productId" = s."productId"
      LEFT JOIN bt ON bt."warehouseId" = COALESCE(s."warehouseId", mv."warehouseId") AND bt."productId" = COALESCE(s."productId", mv."productId")
      WHERE COALESCE(s.quantity, 0) <> COALESCE(mv.net, 0) OR COALESCE(bt.q, 0) > COALESCE(s.quantity, 0)
      LIMIT 500`;
    const issues = rows.map((r) => ({
      warehouseId: r.warehouseId, productId: r.productId, stock: Number(r.stock), movementsNet: Number(r.movements), batches: Number(r.batches),
      problem: Number(r.stock) !== Number(r.movements) ? 'STOCK_NE_MOVEMENTS' : 'BATCHES_EXCEED_STOCK',
    }));
    return { ok: issues.length === 0, issues };
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../sequence/sequence.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser, ReqCtx } from '../common/decorators';
import { can } from '../common/perm';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { LedgerService, MovementRow, StockService } from './stock-ledger.service';
import { SalesCalcService } from './sales-calc.service';
import { Alloc, splitAllocations } from '../inventory/allocation';
import { CancelInvoiceDto, CreateInvoiceDto, InvoicesQuery, LineDto } from './sales.dto';

type Tx = Prisma.TransactionClient;

const INCLUDE = {
  items: { include: { product: { select: { id: true, sku: true, nameAr: true } } } },
  customer: { select: { id: true, code: true, name: true } },
  warehouse: { select: { id: true, name: true } },
} as const;

/** "Paid" here means fully settled (paid + credited by returns). */
export const paymentStatusOf = (net: number, paid: number, returned: number): 'Unpaid' | 'Partial' | 'Paid' =>
  paid + returned >= net ? 'Paid' : paid > 0 ? 'Partial' : 'Unpaid';

@Injectable()
export class InvoicesService {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private scope: ScopeService,
    private stock: StockService, private ledger: LedgerService, private calc: SalesCalcService,
  ) {}

  async list(q: InvoicesQuery, u: AuthUser) {
    const where: Prisma.InvoiceWhereInput = {
      customer: await this.scope.customerScope(u),
      customerId: q.customerId, representativeId: q.representativeId, status: q.status, paymentStatus: q.paymentStatus,
      invoiceDate: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, include: { customer: INCLUDE.customer }, orderBy: { invoiceDate: q.order }, ...skipTake(q) }),
      this.prisma.invoice.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async get(id: string, u: AuthUser) {
    const inv = await this.prisma.invoice.findFirst({ where: { id, customer: await this.scope.customerScope(u) }, include: INCLUDE });
    if (!inv) throw new AppException('NOT_FOUND', 'الفاتورة غير موجودة', 404);
    return inv;
  }

  async create(dto: CreateInvoiceDto, u: AuthUser, ctx: ReqCtx, idempotencyKey?: string) {
    if (idempotencyKey) {
      const ex = await this.prisma.invoice.findFirst({ where: { createdById: u.id, idempotencyKey }, include: INCLUDE });
      if (ex) return ex; // same request sent twice (weak network, double tap): no second invoice
    }
    try {
      return await this.prisma.$transaction((tx) => this.createInTx(tx, { ...dto, trustPrices: false, idempotencyKey }, u, ctx), { timeout: 20_000 });
    } catch (e) {
      if (idempotencyKey && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.invoice.findFirst({ where: { createdById: u.id, idempotencyKey }, include: INCLUDE });
        if (again) return again;
      }
      throw e;
    }
  }

  /**
   * SRS §57 as ONE database transaction: validate customer & stock, compute discount/bonus, create invoice + items,
   * deduct stock, write stock movements, post the ledger, audit. Any failure rolls everything back.
   */
  async createInTx(
    tx: Tx,
    p: { customerId: string; warehouseId: string; lines: LineDto[]; notes?: string; representativeId?: string; trustPrices: boolean; idempotencyKey?: string },
    u: AuthUser, ctx: ReqCtx,
  ) {
    await this.ledger.lockCustomer(tx, p.customerId);
    const customer = await tx.customer.findFirst({ where: { AND: [{ id: p.customerId }, await this.scope.customerScope(u)] } });
    if (!customer) throw new AppException('NOT_FOUND', 'العميل غير موجود', 404);
    if (customer.status !== 'Active') throw new AppException('CUSTOMER_NOT_ACTIVE', 'العميل غير فعّال أو محظور من البيع', 422, { status: customer.status });
    const wh = await tx.warehouse.findUnique({ where: { id: p.warehouseId } });
    if (!wh || !wh.isActive) throw new AppException('INVALID_WAREHOUSE', 'المخزن غير موجود أو غير فعّال', 400);

    const { lines, totals } = await this.calc.buildLines(tx, { customer, lines: p.lines, actor: u, trustPrices: p.trustPrices });

    // stock: sold + free goods both leave the warehouse, taken FEFO from non-expired batches (products in id order: stable lock order)
    const allocByProduct = new Map<string, Alloc[]>();
    for (const l of [...lines].sort((a, b) => a.productId.localeCompare(b.productId))) {
      allocByProduct.set(l.productId, await this.stock.takeFefo(tx, p.warehouseId, l.productId, l.quantity + l.bonusQuantity));
    }

    // credit limit (0 = no limit configured)
    if (customer.creditLimit > 0 && !can(u, 'invoices.override_credit')) {
      const balance = await this.ledger.balance(tx, customer.id);
      if (balance + totals.netTotal > customer.creditLimit) {
        throw new AppException('CREDIT_LIMIT_EXCEEDED', 'تجاوز الحد الائتماني للعميل', 422, { balance, invoiceTotal: totals.netTotal, creditLimit: customer.creditLimit });
      }
    }

    const primary = p.representativeId ? null : await tx.customerRepresentative.findFirst({ where: { customerId: customer.id, assignedTo: null, isPrimary: true } });
    const invoiceNumber = `INV-${String(await this.seq.next('invoice', tx)).padStart(6, '0')}`;
    const inv = await tx.invoice.create({
      data: {
        invoiceNumber, customerId: customer.id, warehouseId: p.warehouseId, representativeId: p.representativeId ?? primary?.representativeId ?? null,
        subtotal: totals.subtotal, discountTotal: totals.discountTotal, bonusValue: totals.bonusValue, taxTotal: totals.taxTotal,
        netTotal: totals.netTotal, remainingAmount: totals.netTotal, paymentStatus: totals.netTotal === 0 ? 'Paid' : 'Unpaid',
        notes: p.notes, createdById: u.id, approvedById: u.id, idempotencyKey: p.idempotencyKey,
        items: {
          create: lines.map((l) => ({
            productId: l.productId, quantity: l.quantity, bonusQuantity: l.bonusQuantity, unitPrice: l.unitPrice,
            discountType: l.discountType, discountValue: l.discountValue, grossAmount: l.gross, discountAmount: l.discountAmount,
            netAmount: l.net, taxRateBp: l.taxRateBp, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
            bonusRuleSnapshot: l.tiers as unknown as Prisma.InputJsonValue,
          })),
        },
      },
      include: INCLUDE,
    });

    // which batches each line came from (so returns go back to the right batch) + batch-aware movements
    const itemIdByProduct = new Map(inv.items.map((i) => [i.productId, i.id]));
    const moves: MovementRow[] = [];
    for (const l of lines) {
      const rows = splitAllocations(allocByProduct.get(l.productId)!, l.quantity, l.bonusQuantity);
      await tx.invoiceItemBatch.createMany({ data: rows.map((r) => ({ invoiceItemId: itemIdByProduct.get(l.productId)!, batchId: r.batchId, quantity: r.quantity, bonusQuantity: r.bonusQuantity })) });
      for (const r of rows) {
        const base = { warehouseId: p.warehouseId, productId: l.productId, movementType: 'Sale' as const, unitCost: r.unitCost, batchNumber: r.batchNumber, expiryDate: r.expiryDate, referenceType: 'Invoice', referenceId: inv.id, createdById: u.id };
        moves.push({ ...base, quantity: r.quantity }, { ...base, quantity: r.bonusQuantity, isBonus: true });
      }
    }
    await this.stock.movements(tx, moves);
    await this.ledger.add(tx, { customerId: customer.id, entryType: 'Invoice', debit: totals.netTotal, referenceType: 'Invoice', referenceId: inv.id, description: invoiceNumber, createdById: u.id });
    await this.audit.log({ userId: u.id, action: 'invoices.create', entity: 'invoice', entityId: inv.id, newValues: { invoiceNumber, totals, lines: lines.map((l) => ({ ...l, tiers: undefined })) }, ctx }, tx);
    return inv;
  }

  /** Cancel = reverse, never delete (SRS §46). Only an untouched invoice (no returns, no payments) can be cancelled. */
  cancel(id: string, dto: CancelInvoiceDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      // lock order: customer -> invoice (same as payments and returns)
      const pre = await tx.invoice.findUnique({ where: { id }, select: { customerId: true } });
      if (!pre) throw new AppException('NOT_FOUND', 'الفاتورة غير موجودة', 404);
      await this.ledger.lockCustomer(tx, pre.customerId);
      await this.ledger.lockInvoice(tx, id);
      const inv = await tx.invoice.findUniqueOrThrow({ where: { id }, include: { items: true } });
      if (inv.status !== 'Confirmed') throw new AppException('ALREADY_CANCELLED', 'الفاتورة ملغاة مسبقاً', 409);
      const returns = await tx.return.count({ where: { invoiceId: id } });
      if (returns > 0 || inv.returnedAmount > 0) throw new AppException('HAS_RETURNS', 'لا يمكن إلغاء فاتورة عليها مردودات', 409);
      if (inv.paidAmount > 0) throw new AppException('HAS_PAYMENTS', 'لا يمكن إلغاء فاتورة عليها تسديدات؛ أنشئ مردوداً/تسوية', 409);

      await tx.invoice.update({ where: { id }, data: { status: 'Cancelled', cancelledAt: new Date(), cancelledById: u.id, cancelReason: dto.reason, remainingAmount: 0 } });
      const allocs = await tx.invoiceItemBatch.findMany({ where: { invoiceItem: { invoiceId: id } }, include: { batch: true } });
      const moves: MovementRow[] = [];
      for (const it of [...inv.items].sort((a, b) => a.productId.localeCompare(b.productId))) {
        const rows = allocs.filter((a) => a.invoiceItemId === it.id);
        // invoices created before batch tracking have no allocation rows: their goods go back as unbatched stock
        const parts = rows.length ? rows.map((r) => ({ batchId: r.batchId, batchNumber: r.batch?.batchNumber ?? null, expiryDate: r.batch?.expiryDate ?? null, sold: r.quantity, bonus: r.bonusQuantity }))
          : [{ batchId: null, batchNumber: null, expiryDate: null as Date | null, sold: it.quantity, bonus: it.bonusQuantity }];
        for (const r of parts) {
          await this.stock.restore(tx, inv.warehouseId, it.productId, r.batchId, r.sold + r.bonus);
          const base = { warehouseId: inv.warehouseId, productId: it.productId, movementType: 'ReturnIn' as const, batchNumber: r.batchNumber, expiryDate: r.expiryDate, referenceType: 'InvoiceCancel', referenceId: id, createdById: u.id };
          moves.push({ ...base, quantity: r.sold }, { ...base, quantity: r.bonus, isBonus: true });
        }
      }
      await this.stock.movements(tx, moves);
      await this.ledger.add(tx, { customerId: inv.customerId, entryType: 'Cancellation', credit: inv.netTotal, referenceType: 'Invoice', referenceId: id, description: `إلغاء ${inv.invoiceNumber}`, createdById: u.id });
      // an order that produced this invoice becomes invoiceable again
      await tx.salesOrder.updateMany({ where: { invoiceId: id }, data: { status: 'Approved', invoiceId: null } });
      await this.audit.log({ userId: u.id, action: 'invoices.cancel', entity: 'invoice', entityId: id, oldValues: { status: 'Confirmed' }, newValues: { status: 'Cancelled', reason: dto.reason, netTotal: inv.netTotal }, ctx }, tx);
      return { id, status: 'Cancelled' };
    }, { timeout: 20_000 });
  }
}

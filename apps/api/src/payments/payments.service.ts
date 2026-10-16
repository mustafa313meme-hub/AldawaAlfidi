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
import { LedgerService } from '../sales/stock-ledger.service';
import { paymentStatusOf } from '../sales/invoices.service';
import { allocatePayment } from './payment-allocation';
import { AllocatePaymentDto, CancelPaymentDto, CreatePaymentDto, PaymentsQuery, SummaryQuery } from './payments.dto';

type Tx = Prisma.TransactionClient;
const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 60 * 86_400_000;

const INCLUDE = {
  allocations: { include: { invoice: { select: { id: true, invoiceNumber: true } } } },
  customer: { select: { id: true, code: true, name: true } },
} as const;

@Injectable()
export class PaymentsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private scope: ScopeService, private ledger: LedgerService) {}

  async list(q: PaymentsQuery, u: AuthUser) {
    const where: Prisma.PaymentWhereInput = {
      customer: await this.scope.customerScope(u),
      customerId: q.customerId, representativeId: q.representativeId, status: q.status, method: q.method,
      paymentDate: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.payment.findMany({ where, include: { customer: INCLUDE.customer }, orderBy: { paymentDate: q.order }, ...skipTake(q) }),
      this.prisma.payment.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async get(id: string, u: AuthUser) {
    const p = await this.prisma.payment.findFirst({ where: { id, customer: await this.scope.customerScope(u) }, include: INCLUDE });
    if (!p) throw new AppException('NOT_FOUND', 'التسديد غير موجود', 404);
    return p;
  }

  /** Collections report (SRS dashboards: "Collections Today / This Month"): confirmed payments only. */
  async summary(q: SummaryQuery, u: AuthUser) {
    const where: Prisma.PaymentWhereInput = {
      status: 'Confirmed', customer: await this.scope.customerScope(u), representativeId: q.representativeId,
      paymentDate: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [total, byMethod, byRep] = await Promise.all([
      this.prisma.payment.aggregate({ where, _sum: { amount: true }, _count: true }),
      this.prisma.payment.groupBy({ by: ['method'], where, _sum: { amount: true }, _count: true }),
      this.prisma.payment.groupBy({ by: ['representativeId'], where, _sum: { amount: true }, _count: true }),
    ]);
    return {
      total: total._sum.amount ?? 0, count: total._count,
      byMethod: byMethod.map((m) => ({ method: m.method, amount: m._sum.amount ?? 0, count: m._count })),
      byRepresentative: byRep.map((r) => ({ representativeId: r.representativeId, amount: r._sum.amount ?? 0, count: r._count })),
    };
  }

  /** Apply `delta` (may be negative) to an invoice's paid amount and refresh remaining/status from fresh values. */
  private async applyToInvoice(tx: Tx, invoiceId: string, delta: number) {
    const inv = await tx.invoice.findUniqueOrThrow({ where: { id: invoiceId } });
    const paid = inv.paidAmount + delta;
    if (paid < 0 || paid > inv.netTotal) throw new AppException('INVALID_ALLOCATION', 'مبلغ التسديد يتجاوز المتبقي على الفاتورة', 409, { invoiceId, paid, netTotal: inv.netTotal });
    await tx.invoice.update({
      where: { id: invoiceId },
      data: { paidAmount: paid, remainingAmount: Math.max(0, inv.netTotal - paid - inv.returnedAmount), paymentStatus: paymentStatusOf(inv.netTotal, paid, inv.returnedAmount) },
    });
  }

  private async openInvoices(tx: Tx, customerId: string) {
    // customer lock is already held; the invoice row locks make the order explicit and cheap to reason about
    await tx.$queryRaw`SELECT id FROM invoices WHERE "customerId" = ${customerId} AND status = 'Confirmed' AND "remainingAmount" > 0 ORDER BY id FOR UPDATE`;
    const rows = await tx.invoice.findMany({ where: { customerId, status: 'Confirmed', remainingAmount: { gt: 0 } }, select: { id: true, remainingAmount: true, invoiceDate: true } });
    return rows.map((r) => ({ id: r.id, remaining: r.remainingAmount, date: r.invoiceDate }));
  }

  async create(dto: CreatePaymentDto, u: AuthUser, ctx: ReqCtx) {
    if (dto.localId && !ctx.device) throw new AppException('DEVICE_REQUIRED', 'أرسل x-device-id مع localId', 400);
    if (dto.localId && ctx.device) {
      const ex = await this.prisma.payment.findUnique({ where: { deviceId_localId: { deviceId: ctx.device, localId: dto.localId } }, include: INCLUDE });
      if (ex) return ex; // idempotent retry from an offline device
    }
    const when = dto.paymentDate ? new Date(dto.paymentDate) : new Date();
    if (when.getTime() > Date.now() + MAX_FUTURE_MS) throw new AppException('INVALID_DATE', 'تاريخ التسديد في المستقبل', 400);
    if (when.getTime() < Date.now() - MAX_AGE_MS) throw new AppException('INVALID_DATE', 'تاريخ التسديد قديم جداً', 400);

    const myRep = await this.scope.repOf(u);
    const fieldRep = !can(u, 'customers.view_all');
    if (fieldRep && !myRep) throw new AppException('NOT_A_REPRESENTATIVE', 'حسابك غير مرتبط بمندوب', 403);
    if (fieldRep && dto.representativeId && dto.representativeId !== myRep!.id) throw new AppException('FORBIDDEN', 'لا يمكنك تسجيل تسديد باسم مندوب آخر', 403);
    const representativeId = fieldRep ? myRep!.id : dto.representativeId ?? myRep?.id ?? null;
    const scope = await this.scope.customerScope(u);

    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await tx.customer.findFirst({ where: { AND: [{ id: dto.customerId }, scope] }, select: { id: true } });
        if (!customer) throw new AppException('NOT_FOUND', 'العميل غير موجود', 404);
        await this.ledger.lockCustomer(tx, customer.id); // lock order: customer -> invoices

        const open = await this.openInvoices(tx, customer.id);
        if (dto.invoiceId && !open.some((i) => i.id === dto.invoiceId)) {
          throw new AppException('INVOICE_NOT_OPEN', 'الفاتورة غير موجودة لهذا العميل أو لا يوجد عليها متبقٍّ', 400, { invoiceId: dto.invoiceId });
        }
        const plan = allocatePayment(dto.amount, open, dto.invoiceId, dto.autoAllocate ?? true);

        const paymentNumber = `PAY-${String(await this.seq.next('payment', tx)).padStart(6, '0')}`;
        const pay = await tx.payment.create({
          data: {
            paymentNumber, customerId: customer.id, invoiceId: dto.invoiceId, amount: dto.amount, allocatedAmount: plan.allocated, method: dto.method,
            paymentDate: when, referenceNumber: dto.referenceNumber, representativeId, receivedById: u.id, notes: dto.notes,
            deviceId: dto.localId ? ctx.device : null, localId: dto.localId ?? null,
            allocations: { create: plan.allocations.map((a) => ({ invoiceId: a.invoiceId, amount: a.amount })) },
          },
          include: INCLUDE,
        });
        for (const a of [...plan.allocations].sort((x, y) => x.invoiceId.localeCompare(y.invoiceId))) await this.applyToInvoice(tx, a.invoiceId, a.amount);

        // the balance falls by the FULL amount, whether or not it is allocated yet
        await this.ledger.add(tx, { customerId: customer.id, entryType: 'Payment', credit: dto.amount, referenceType: 'Payment', referenceId: pay.id, description: paymentNumber, createdById: u.id });
        await this.audit.log({ userId: u.id, action: 'payments.create', entity: 'payment', entityId: pay.id, newValues: { paymentNumber, amount: dto.amount, method: dto.method, allocations: plan.allocations, unallocated: plan.unallocated }, ctx }, tx);
        return pay;
      }, { timeout: 20_000 });
    } catch (e) {
      if (dto.localId && ctx.device && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.payment.findUnique({ where: { deviceId_localId: { deviceId: ctx.device, localId: dto.localId } }, include: INCLUDE });
        if (again) return again;
      }
      throw e;
    }
  }

  /** Allocate part of a payment's unallocated credit to a specific open invoice later. */
  allocate(id: string, dto: AllocatePaymentDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const pre = await tx.payment.findUnique({ where: { id }, select: { customerId: true } });
      if (!pre) throw new AppException('NOT_FOUND', 'التسديد غير موجود', 404);
      await this.ledger.lockCustomer(tx, pre.customerId);
      const pay = await tx.payment.findUniqueOrThrow({ where: { id } });
      if (pay.status !== 'Confirmed') throw new AppException('PAYMENT_CANCELLED', 'التسديد ملغى', 409);
      const free = pay.amount - pay.allocatedAmount;
      if (dto.amount > free) throw new AppException('EXCEEDS_UNALLOCATED', 'المبلغ يتجاوز الرصيد غير الموزّع من التسديد', 422, { unallocated: free });
      const inv = await tx.invoice.findFirst({ where: { id: dto.invoiceId, customerId: pay.customerId, status: 'Confirmed' } });
      if (!inv) throw new AppException('INVOICE_NOT_OPEN', 'الفاتورة غير موجودة لهذا العميل', 400);
      if (dto.amount > inv.remainingAmount) throw new AppException('EXCEEDS_REMAINING', 'المبلغ يتجاوز المتبقي على الفاتورة', 422, { remaining: inv.remainingAmount });

      await tx.paymentAllocation.create({ data: { paymentId: id, invoiceId: inv.id, amount: dto.amount } });
      await tx.payment.update({ where: { id }, data: { allocatedAmount: { increment: dto.amount } } });
      await this.applyToInvoice(tx, inv.id, dto.amount);
      await this.audit.log({ userId: u.id, action: 'payments.allocate', entity: 'payment', entityId: id, newValues: { invoiceId: inv.id, amount: dto.amount }, ctx }, tx);
      return tx.payment.findUniqueOrThrow({ where: { id }, include: INCLUDE });
    });
  }

  /** Cancel = reverse, never delete: ledger debit for the full amount, allocations released from their invoices. */
  cancel(id: string, dto: CancelPaymentDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const pre = await tx.payment.findUnique({ where: { id }, select: { customerId: true } });
      if (!pre) throw new AppException('NOT_FOUND', 'التسديد غير موجود', 404);
      await this.ledger.lockCustomer(tx, pre.customerId);
      const claimed = await tx.payment.updateMany({ where: { id, status: 'Confirmed' }, data: { status: 'Cancelled', cancelledAt: new Date(), cancelledById: u.id, cancelReason: dto.reason } });
      if (claimed.count !== 1) throw new AppException('ALREADY_CANCELLED', 'التسديد ملغى مسبقاً', 409);
      const pay = await tx.payment.findUniqueOrThrow({ where: { id }, include: { allocations: true } });
      for (const a of [...pay.allocations].sort((x, y) => x.invoiceId.localeCompare(y.invoiceId))) await this.applyToInvoice(tx, a.invoiceId, -a.amount);
      await this.ledger.add(tx, { customerId: pay.customerId, entryType: 'Cancellation', debit: pay.amount, referenceType: 'Payment', referenceId: id, description: `إلغاء ${pay.paymentNumber}`, createdById: u.id });
      await this.audit.log({ userId: u.id, action: 'payments.cancel', entity: 'payment', entityId: id, oldValues: { status: 'Confirmed', amount: pay.amount, allocations: pay.allocations }, newValues: { status: 'Cancelled', reason: dto.reason }, ctx }, tx);
      return { id, status: 'Cancelled' };
    }, { timeout: 20_000 });
  }

  /**
   * Books integrity check for money (run after testing and on a schedule). Empty arrays = consistent:
   *  - invoice.paidAmount = SUM(allocations of confirmed payments)
   *  - invoice.remainingAmount = max(0, net - paid - returned)
   *  - every invoice has a ledger debit equal to its net total
   *  - payment.allocatedAmount = SUM(its allocations); every confirmed payment has a ledger credit equal to its amount
   */
  async reconcile() {
    const [paid, remaining, invoiceLedger, allocated, paymentLedger] = await Promise.all([
      this.prisma.$queryRaw<{ id: string; invoiceNumber: string; stored: bigint; computed: bigint }[]>`
        SELECT i.id, i."invoiceNumber", i."paidAmount"::bigint AS stored, COALESCE(a.s, 0)::bigint AS computed
        FROM invoices i LEFT JOIN (
          SELECT pa."invoiceId", SUM(pa.amount) AS s FROM payment_allocations pa JOIN payments p ON p.id = pa."paymentId" WHERE p.status = 'Confirmed' GROUP BY 1) a ON a."invoiceId" = i.id
        WHERE i."paidAmount" <> COALESCE(a.s, 0) LIMIT 100`,
      this.prisma.$queryRaw<{ id: string; invoiceNumber: string; stored: bigint; expected: bigint }[]>`
        SELECT id, "invoiceNumber", "remainingAmount"::bigint AS stored, GREATEST(0, "netTotal" - "paidAmount" - "returnedAmount")::bigint AS expected
        FROM invoices WHERE status = 'Confirmed' AND "remainingAmount" <> GREATEST(0, "netTotal" - "paidAmount" - "returnedAmount") LIMIT 100`,
      this.prisma.$queryRaw<{ id: string; invoiceNumber: string; netTotal: bigint; ledgerDebit: bigint }[]>`
        SELECT i.id, i."invoiceNumber", i."netTotal"::bigint AS "netTotal", COALESCE(l.d, 0)::bigint AS "ledgerDebit"
        FROM invoices i LEFT JOIN (
          SELECT "referenceId", SUM(debit) AS d FROM ledger_entries WHERE "entryType" = 'Invoice' AND "referenceType" = 'Invoice' GROUP BY 1) l ON l."referenceId" = i.id
        WHERE COALESCE(l.d, 0) <> i."netTotal" LIMIT 100`,
      this.prisma.$queryRaw<{ id: string; paymentNumber: string; stored: bigint; computed: bigint }[]>`
        SELECT p.id, p."paymentNumber", p."allocatedAmount"::bigint AS stored, COALESCE(a.s, 0)::bigint AS computed
        FROM payments p LEFT JOIN (SELECT "paymentId", SUM(amount) AS s FROM payment_allocations GROUP BY 1) a ON a."paymentId" = p.id
        WHERE p."allocatedAmount" <> COALESCE(a.s, 0) LIMIT 100`,
      this.prisma.$queryRaw<{ id: string; paymentNumber: string; amount: bigint; ledgerCredit: bigint }[]>`
        SELECT p.id, p."paymentNumber", p.amount::bigint AS amount, COALESCE(l.c, 0)::bigint AS "ledgerCredit"
        FROM payments p LEFT JOIN (
          SELECT "referenceId", SUM(credit) AS c FROM ledger_entries WHERE "entryType" = 'Payment' AND "referenceType" = 'Payment' GROUP BY 1) l ON l."referenceId" = p.id
        WHERE COALESCE(l.c, 0) <> p.amount LIMIT 100`,
    ]);
    const n = (r: Record<string, unknown>[]) => r.map((x) => Object.fromEntries(Object.entries(x).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v])));
    const result = {
      invoicePaidMismatch: n(paid), invoiceRemainingMismatch: n(remaining), invoiceLedgerMismatch: n(invoiceLedger),
      paymentAllocatedMismatch: n(allocated), paymentLedgerMismatch: n(paymentLedger),
    };
    return { ok: Object.values(result).every((v) => v.length === 0), ...result };
  }
}

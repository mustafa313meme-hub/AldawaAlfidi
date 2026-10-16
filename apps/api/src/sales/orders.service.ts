import { Injectable } from '@nestjs/common';
import { OrderStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../sequence/sequence.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser, ReqCtx } from '../common/decorators';
import { can } from '../common/perm';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { InvoicesService } from './invoices.service';
import { NotificationsService } from '../notifications/notifications.service';
import { ComputedLine, SalesCalcService, totalsOf } from './sales-calc.service';
import { ConvertOrderDto, CreateOrderDto, LineDto, OrdersQuery, PreviewDto, UpdateOrderDto } from './sales.dto';

type Tx = Prisma.TransactionClient;
const INCLUDE = {
  items: { include: { product: { select: { id: true, sku: true, nameAr: true } } } },
  customer: { select: { id: true, code: true, name: true } },
} as const;

const itemRows = (lines: ComputedLine[]) => lines.map((l) => ({
  productId: l.productId, quantity: l.quantity, bonusQuantity: l.bonusQuantity, unitPrice: l.unitPrice,
  discountType: l.discountType, discountValue: l.discountValue, discountAmount: l.discountAmount,
  taxRateBp: l.taxRateBp, taxAmount: l.taxAmount, lineTotal: l.lineTotal,
}));

@Injectable()
export class OrdersService {
  constructor(
    private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private scope: ScopeService,
    private calc: SalesCalcService, private invoices: InvoicesService, private notifications: NotificationsService,
  ) {}

  private async customerFor(tx: Tx, id: string, u: AuthUser) {
    const c = await tx.customer.findFirst({ where: { AND: [{ id }, await this.scope.customerScope(u)] } });
    if (!c) throw new AppException('NOT_FOUND', 'العميل غير موجود', 404);
    if (c.status !== 'Active') throw new AppException('CUSTOMER_NOT_ACTIVE', 'العميل غير فعّال أو محظور من البيع', 422, { status: c.status });
    return c;
  }

  /** Price/bonus preview for the mobile app ("رؤية السعر والبونص المتاح"). Prices need products.view_prices. */
  async preview(dto: PreviewDto, u: AuthUser) {
    if (!can(u, 'products.view_prices')) throw new AppException('FORBIDDEN', 'رؤية الأسعار تتطلب صلاحية', 403);
    const customer = await this.customerFor(this.prisma, dto.customerId, u);
    const { lines, totals } = await this.calc.buildLines(this.prisma, { customer, lines: dto.lines, actor: u });
    return { lines: lines.map((l) => ({ ...l, tiers: undefined })), totals };
  }

  async list(q: OrdersQuery, u: AuthUser) {
    const where: Prisma.SalesOrderWhereInput = {
      customer: await this.scope.customerScope(u), status: q.status, customerId: q.customerId, representativeId: q.representativeId,
      orderDate: q.from || q.to ? { gte: q.from ? new Date(q.from) : undefined, lte: q.to ? new Date(q.to) : undefined } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.salesOrder.findMany({ where, include: { customer: INCLUDE.customer }, orderBy: { orderDate: q.order }, ...skipTake(q) }),
      this.prisma.salesOrder.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async get(id: string, u: AuthUser) {
    const o = await this.prisma.salesOrder.findFirst({ where: { id, customer: await this.scope.customerScope(u) }, include: INCLUDE });
    if (!o) throw new AppException('NOT_FOUND', 'الطلب غير موجود', 404);
    return o;
  }

  async create(dto: CreateOrderDto, u: AuthUser, ctx: ReqCtx) {
    if (dto.localId && !ctx.device) throw new AppException('DEVICE_REQUIRED', 'أرسل x-device-id مع localId', 400);
    if (dto.localId && ctx.device) {
      const ex = await this.prisma.salesOrder.findUnique({ where: { deviceId_localId: { deviceId: ctx.device, localId: dto.localId } }, include: INCLUDE });
      if (ex) return ex; // idempotent retry from an offline device
    }
    const myRep = await this.scope.repOf(u);
    const fieldRep = !can(u, 'customers.view_all');
    if (fieldRep && !myRep) throw new AppException('NOT_A_REPRESENTATIVE', 'حسابك غير مرتبط بمندوب', 403);
    if (fieldRep && dto.representativeId && dto.representativeId !== myRep!.id) throw new AppException('FORBIDDEN', 'لا يمكنك إنشاء طلب باسم مندوب آخر', 403);
    const repId = fieldRep ? myRep!.id : dto.representativeId ?? myRep?.id ?? null;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const customer = await this.customerFor(tx, dto.customerId, u);
        if (dto.warehouseId) {
          const w = await tx.warehouse.findUnique({ where: { id: dto.warehouseId } });
          if (!w || !w.isActive) throw new AppException('INVALID_WAREHOUSE', 'المخزن غير موجود أو غير فعّال', 400);
        }
        const { lines, totals } = await this.calc.buildLines(tx, { customer, lines: dto.lines, actor: u });
        const orderNumber = `ORD-${String(await this.seq.next('order', tx)).padStart(6, '0')}`;
        const o = await tx.salesOrder.create({
          data: {
            orderNumber, customerId: customer.id, representativeId: repId, warehouseId: dto.warehouseId, notes: dto.notes,
            status: dto.submit ? 'Submitted' : 'Draft', subtotal: totals.subtotal, discountTotal: totals.discountTotal,
            bonusValue: totals.bonusValue, taxTotal: totals.taxTotal, total: totals.netTotal,
            deviceId: dto.localId ? ctx.device : null, localId: dto.localId ?? null, createdById: u.id,
            items: { create: itemRows(lines) },
          },
          include: INCLUDE,
        });
        await this.audit.log({ userId: u.id, action: 'orders.create', entity: 'order', entityId: o.id, newValues: { orderNumber, status: o.status, totals }, ctx }, tx);
        return o;
      });
    } catch (e) {
      if (dto.localId && ctx.device && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.salesOrder.findUnique({ where: { deviceId_localId: { deviceId: ctx.device, localId: dto.localId } }, include: INCLUDE });
        if (again) return again;
      }
      throw e;
    }
  }

  /** Editable: Draft/Submitted by whoever can see the customer; Approved only by approvers ("وفق الصلاحية"). */
  update(id: string, dto: UpdateOrderDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.salesOrder.findFirst({ where: { id, customer: await this.scope.customerScope(u) }, include: { items: true } });
      if (!before) throw new AppException('NOT_FOUND', 'الطلب غير موجود', 404);
      const editable = before.status === 'Draft' || before.status === 'Submitted' || (before.status === 'Approved' && can(u, 'orders.approve'));
      if (!editable) throw new AppException('ORDER_LOCKED', 'لا يمكن تعديل الطلب في حالته الحالية', 409, { status: before.status });

      const data: Prisma.SalesOrderUncheckedUpdateInput = { notes: dto.notes, warehouseId: dto.warehouseId };
      if (dto.lines) {
        const customer = await this.customerFor(tx, before.customerId, u);
        const { lines, totals } = await this.calc.buildLines(tx, { customer, lines: dto.lines, actor: u });
        await tx.salesOrderItem.deleteMany({ where: { orderId: id } });
        await tx.salesOrderItem.createMany({ data: itemRows(lines).map((r) => ({ ...r, orderId: id })) });
        Object.assign(data, { subtotal: totals.subtotal, discountTotal: totals.discountTotal, bonusValue: totals.bonusValue, taxTotal: totals.taxTotal, total: totals.netTotal });
      }
      const after = await tx.salesOrder.update({ where: { id }, data, include: INCLUDE });
      await this.audit.log({ userId: u.id, action: 'orders.update', entity: 'order', entityId: id, oldValues: { total: before.total, items: before.items }, newValues: { total: after.total, items: after.items }, ctx }, tx);
      return after;
    });
  }

  /** Atomic status change: the WHERE on the current status makes concurrent transitions safe. */
  private async move(id: string, from: OrderStatus[], to: OrderStatus, u: AuthUser, ctx: ReqCtx, extra: Prisma.SalesOrderUncheckedUpdateManyInput = {}) {
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.salesOrder.findFirst({ where: { id, customer: await this.scope.customerScope(u) } });
      if (!o) throw new AppException('NOT_FOUND', 'الطلب غير موجود', 404);
      const r = await tx.salesOrder.updateMany({ where: { id, status: { in: from } }, data: { status: to, ...extra } });
      if (r.count !== 1) throw new AppException('INVALID_TRANSITION', `لا يمكن نقل الطلب من ${o.status} إلى ${to}`, 409, { status: o.status });
      await this.audit.log({ userId: u.id, action: `orders.${to.toLowerCase()}`, entity: 'order', entityId: id, oldValues: { status: o.status }, newValues: { status: to }, ctx }, tx);
      return { id, status: to };
    });
  }

  submit(id: string, u: AuthUser, ctx: ReqCtx) { return this.move(id, ['Draft'], 'Submitted', u, ctx); }
  async approve(id: string, u: AuthUser, ctx: ReqCtx) {
    const r = await this.move(id, ['Submitted'], 'Approved', u, ctx, { approvedById: u.id });
    await this.tellCreator(id, 'Approved', u);
    return r;
  }

  private async tellCreator(id: string, to: 'Approved' | 'Cancelled', actor: AuthUser) {
    const o = await this.prisma.salesOrder.findUnique({ where: { id }, select: { createdById: true, orderNumber: true } });
    if (!o?.createdById || o.createdById === actor.id) return;
    await this.notifications.notifyUsers([o.createdById], {
      type: `order_${to.toLowerCase()}`, title: to === 'Approved' ? 'تمت الموافقة على طلبك' : 'أُلغي طلبك', body: o.orderNumber, data: { orderId: id }, dedupeKey: `order:${id}:${to}`,
    });
  }
  prepare(id: string, u: AuthUser, ctx: ReqCtx) { return this.move(id, ['Approved'], 'Preparing', u, ctx); }

  async cancel(id: string, u: AuthUser, ctx: ReqCtx) {
    // the field rep may withdraw their own order until it is approved; later only orders.cancel holders
    const o = await this.get(id, u);
    const allowed = can(u, 'orders.cancel') || ((o.status === 'Draft' || o.status === 'Submitted') && o.createdById === u.id);
    if (!allowed) throw new AppException('FORBIDDEN', 'غير مسموح لك بإلغاء هذا الطلب', 403);
    const r = await this.move(id, ['Draft', 'Submitted', 'Approved', 'Preparing'], 'Cancelled', u, ctx);
    await this.tellCreator(id, 'Cancelled', u);
    return r;
  }

  /** Order -> invoice in one transaction. The order's agreed prices/discounts are kept; stock, credit and bonus are checked now. */
  convert(id: string, dto: ConvertOrderDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const o = await tx.salesOrder.findFirst({ where: { id, customer: await this.scope.customerScope(u) }, include: { items: true } });
      if (!o) throw new AppException('NOT_FOUND', 'الطلب غير موجود', 404);
      const warehouseId = dto.warehouseId ?? o.warehouseId;
      if (!warehouseId) throw new AppException('WAREHOUSE_REQUIRED', 'حدّد المخزن', 400);

      const claimed = await tx.salesOrder.updateMany({ where: { id, status: { in: ['Approved', 'Preparing'] }, invoiceId: null }, data: { status: 'Delivered', warehouseId } });
      if (claimed.count !== 1) throw new AppException('INVALID_TRANSITION', 'الطلب غير جاهز للتحويل إلى فاتورة أو حُوِّل مسبقاً', 409, { status: o.status });

      const lines: LineDto[] = o.items.map((i) => ({
        productId: i.productId, quantity: i.quantity, unitPrice: i.unitPrice,
        discountType: i.discountType ?? undefined,
        discountValue: i.discountType === 'Percent' ? i.discountValue / 100 : i.discountType === 'Amount' ? i.discountValue : undefined,
      }));
      const inv = await this.invoices.createInTx(tx, { customerId: o.customerId, warehouseId, lines, notes: o.notes ?? undefined, representativeId: o.representativeId ?? undefined, trustPrices: true }, u, ctx);
      await tx.salesOrder.update({ where: { id }, data: { invoiceId: inv.id } });
      await this.audit.log({ userId: u.id, action: 'orders.convert', entity: 'order', entityId: id, newValues: { invoiceId: inv.id, invoiceNumber: inv.invoiceNumber }, ctx }, tx);
      return inv;
    }, { timeout: 20_000 });
  }
}

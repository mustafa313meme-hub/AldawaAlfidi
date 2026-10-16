import { Body, Controller, Get, Headers, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { normalizeSearch } from '../common/arabic';
import { can } from '../common/perm';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { InvoicesService } from './invoices.service';
import { OrdersService } from './orders.service';
import { ReturnsService } from './returns.service';
import { LedgerService, StockService } from './stock-ledger.service';
import {
  BonusRulesQuery, CancelInvoiceDto, ConvertOrderDto, CreateBonusRuleDto, CreateInvoiceDto, CreateOrderDto, CreateReturnDto, InvoicesQuery,
  OpeningStockDto, OrdersQuery, PreviewDto, ReturnsQuery, StatementQuery, StockQuery, UpdateBonusRuleDto, UpdateOrderDto,
} from './sales.dto';

// ───── Orders ─────
@Controller('orders')
export class OrdersController {
  constructor(private orders: OrdersService) {}

  @Get() @RequirePermissions('orders.view')
  list(@Query() q: OrdersQuery, @CurrentUser() u: AuthUser) { return this.orders.list(q, u); }

  @Post('preview') @HttpCode(200) @RequirePermissions('orders.create')
  preview(@Body() dto: PreviewDto, @CurrentUser() u: AuthUser) { return this.orders.preview(dto, u); }

  @Get(':id') @RequirePermissions('orders.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.orders.get(id, u); }

  @Post() @RequirePermissions('orders.create')
  create(@Body() dto: CreateOrderDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.orders.create(dto, u, ctx); }

  @Patch(':id') @RequirePermissions('orders.create')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateOrderDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.orders.update(id, dto, u, ctx); }

  @Post(':id/submit') @HttpCode(200) @RequirePermissions('orders.create')
  submit(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.orders.submit(id, u, ctx); }

  @Post(':id/approve') @HttpCode(200) @RequirePermissions('orders.approve')
  approve(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.orders.approve(id, u, ctx); }

  @Post(':id/prepare') @HttpCode(200) @RequirePermissions('orders.approve')
  prepare(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.orders.prepare(id, u, ctx); }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('orders.view')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.orders.cancel(id, u, ctx); }

  @Post(':id/convert-to-invoice') @RequirePermissions('invoices.create')
  convert(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ConvertOrderDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.orders.convert(id, dto, u, ctx); }
}

// ───── Invoices (never deleted: cancel/reverse) ─────
@Controller('invoices')
export class InvoicesController {
  constructor(private invoices: InvoicesService) {}

  @Get() @RequirePermissions('invoices.view')
  list(@Query() q: InvoicesQuery, @CurrentUser() u: AuthUser) { return this.invoices.list(q, u); }

  @Get(':id') @RequirePermissions('invoices.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.invoices.get(id, u); }

  @Post() @RequirePermissions('invoices.create')
  create(@Body() dto: CreateInvoiceDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx, @Headers('idempotency-key') key?: string) {
    return this.invoices.create(dto, u, ctx, key ? key.slice(0, 100) : undefined);
  }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('invoices.cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelInvoiceDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.invoices.cancel(id, dto, u, ctx); }
}

// ───── Returns ─────
@Controller('returns')
export class ReturnsController {
  constructor(private returns: ReturnsService) {}

  @Get() @RequirePermissions('returns.view')
  list(@Query() q: ReturnsQuery, @CurrentUser() u: AuthUser) { return this.returns.list(q, u); }

  @Get(':id') @RequirePermissions('returns.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.returns.get(id, u); }

  @Post() @RequirePermissions('returns.create')
  create(@Body() dto: CreateReturnDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.returns.create(dto, u, ctx); }
}

// ───── Bonus rules ─────
@Controller('bonus-rules')
export class BonusRulesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermissions('bonus_rules.view')
  async list(@Query() q: BonusRulesQuery) {
    const where: Prisma.BonusRuleWhereInput = { productId: q.productId, isActive: q.isActive };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.bonusRule.findMany({ where, include: { product: { select: { id: true, sku: true, nameAr: true } } }, orderBy: [{ productId: 'asc' }, { minQuantity: 'asc' }], ...skipTake(q) }),
      this.prisma.bonusRule.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  private checkDates(s?: Date | null, e?: Date | null) {
    if (s && e && e < s) throw new AppException('INVALID_RANGE', 'تاريخ النهاية قبل البداية', 400);
  }

  @Post() @RequirePermissions('bonus_rules.manage')
  create(@Body() dto: CreateBonusRuleDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    const startDate = dto.startDate ? new Date(dto.startDate.slice(0, 10)) : null;
    const endDate = dto.endDate ? new Date(dto.endDate.slice(0, 10)) : null;
    this.checkDates(startDate, endDate);
    return this.prisma.$transaction(async (tx) => {
      const p = await tx.product.findUnique({ where: { id: dto.productId } });
      if (!p) throw new AppException('INVALID_PRODUCT', 'المنتج غير موجود', 400);
      const r = await tx.bonusRule.create({ data: { productId: dto.productId, minQuantity: dto.minQuantity, bonusQuantity: dto.bonusQuantity, startDate, endDate, customerType: dto.customerType ?? null } });
      await this.audit.log({ userId: u.id, action: 'bonus_rules.create', entity: 'bonus_rule', entityId: r.id, newValues: r, ctx }, tx);
      return r;
    });
  }

  /** Changing a rule never touches issued invoices: each invoice line keeps its own snapshot of the rules it was sold under. */
  @Patch(':id') @RequirePermissions('bonus_rules.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateBonusRuleDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.bonusRule.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND', 'القاعدة غير موجودة', 404);
      const startDate = dto.startDate !== undefined ? new Date(dto.startDate.slice(0, 10)) : before.startDate;
      const endDate = dto.endDate !== undefined ? new Date(dto.endDate.slice(0, 10)) : before.endDate;
      this.checkDates(startDate, endDate);
      const after = await tx.bonusRule.update({ where: { id }, data: { minQuantity: dto.minQuantity, bonusQuantity: dto.bonusQuantity, startDate, endDate, customerType: dto.customerType, isActive: dto.isActive } });
      await this.audit.log({ userId: u.id, action: dto.isActive === false ? 'bonus_rules.deactivate' : 'bonus_rules.update', entity: 'bonus_rule', entityId: id, oldValues: before, newValues: after, ctx }, tx);
      return after;
    });
  }
}

// ───── Stock (minimal: opening balance + read). Purchases/transfers/adjustments/batches come in Phase 5 ─────
@Controller('stock')
export class StockController {
  constructor(private prisma: PrismaService, private audit: AuditService, private stock: StockService) {}

  @Get() @RequirePermissions('inventory.view')
  async list(@Query() q: StockQuery, @CurrentUser() u: AuthUser) {
    const terms = q.q ? normalizeSearch(q.q).split(' ').filter(Boolean) : [];
    const where: Prisma.StockWhereInput = { warehouseId: q.warehouseId, productId: q.productId, ...(terms.length ? { product: { AND: terms.map((t) => ({ searchText: { contains: t } })) } } : {}) };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stock.findMany({ where, include: { product: { select: { id: true, sku: true, nameAr: true } }, warehouse: { select: { id: true, name: true } } }, orderBy: { product: { nameAr: 'asc' } }, ...skipTake(q) }),
      this.prisma.stock.count({ where }),
    ]);
    const seeCost = can(u, 'products.view_cost');
    return new Paginated(items.map((i) => (seeCost ? i : { ...i, averageCost: undefined, lastCost: undefined })), { page: q.page, pageSize: q.pageSize, total });
  }

  @Get('movements') @RequirePermissions('inventory.view')
  async movements(@Query() q: StockQuery) {
    const where: Prisma.StockMovementWhereInput = { warehouseId: q.warehouseId, productId: q.productId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.stockMovement.findMany({ where, orderBy: { createdAt: q.order }, ...skipTake(q) }),
      this.prisma.stockMovement.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  /** Opening quantity per warehouse/product (optionally as a batch). Only before any other movement; afterwards use purchases/adjustments. */
  @Post('opening') @RequirePermissions('inventory.adjust')
  opening(@Body() dto: OpeningStockDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const [w, p, existing] = await Promise.all([
        tx.warehouse.findUnique({ where: { id: dto.warehouseId } }), tx.product.findUnique({ where: { id: dto.productId } }),
        tx.stockMovement.count({ where: { warehouseId: dto.warehouseId, productId: dto.productId } }),
      ]);
      if (!w || !w.isActive) throw new AppException('INVALID_WAREHOUSE', 'المخزن غير موجود أو غير فعّال', 400);
      if (!p) throw new AppException('INVALID_PRODUCT', 'المنتج غير موجود', 400);
      if (existing > 0) throw new AppException('OPENING_EXISTS', 'توجد حركات لهذا المنتج في المخزن؛ لا يمكن إدخال رصيد افتتاحي', 409);
      const expiry = dto.expiryDate ? new Date(dto.expiryDate.slice(0, 10)) : null;
      const r = await this.stock.receive(tx, { warehouseId: dto.warehouseId, productId: dto.productId, qty: dto.quantity, totalCost: (dto.unitCost ?? 0) * dto.quantity, batchNumber: dto.batchNumber ?? null, expiryDate: expiry });
      const rid = `${dto.warehouseId}:${dto.productId}`;
      await this.stock.movements(tx, [{ warehouseId: dto.warehouseId, productId: dto.productId, movementType: 'OpeningBalance', quantity: dto.quantity, unitCost: r.unitCost, batchNumber: dto.batchNumber ?? null, expiryDate: expiry, referenceType: 'Opening', referenceId: rid, createdById: u.id }]);
      const s = await tx.stock.findUniqueOrThrow({ where: { warehouseId_productId: { warehouseId: dto.warehouseId, productId: dto.productId } } });
      await this.audit.log({ userId: u.id, action: 'stock.opening', entity: 'stock', entityId: rid, newValues: dto, ctx }, tx);
      return s;
    });
  }
}

// ───── Customer balance & statement (ledger-derived) ─────
@Controller('customers/:id')
export class LedgerController {
  constructor(private prisma: PrismaService, private scope: ScopeService, private ledger: LedgerService) {}

  private async customer(id: string, u: AuthUser) {
    const c = await this.prisma.customer.findFirst({ where: { AND: [{ id }, await this.scope.customerScope(u)] }, select: { id: true, code: true, name: true, openingBalance: true, creditLimit: true } });
    if (!c) throw new AppException('NOT_FOUND', 'العميل غير موجود', 404);
    return c;
  }

  @Get('balance') @RequirePermissions('ledger.view')
  async balance(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    const c = await this.customer(id, u);
    const balance = await this.ledger.balance(this.prisma, id);
    const pays = await this.prisma.payment.aggregate({ where: { customerId: id, status: 'Confirmed' }, _sum: { amount: true, allocatedAmount: true } });
    const unallocatedPayments = (pays._sum.amount ?? 0) - (pays._sum.allocatedAmount ?? 0);
    return { customerId: id, balance, creditLimit: c.creditLimit, availableCredit: c.creditLimit > 0 ? c.creditLimit - balance : null, unallocatedPayments };
  }

  /** Unpaid invoices, oldest first, with their age: the collection screen. */
  @Get('open-invoices') @RequirePermissions('ledger.view')
  async openInvoices(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    await this.customer(id, u);
    const rows = await this.prisma.invoice.findMany({
      where: { customerId: id, status: 'Confirmed', remainingAmount: { gt: 0 } }, orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }],
      select: { id: true, invoiceNumber: true, invoiceDate: true, netTotal: true, paidAmount: true, returnedAmount: true, remainingAmount: true, paymentStatus: true },
    });
    const now = Date.now();
    return rows.map((r) => ({ ...r, ageDays: Math.floor((now - r.invoiceDate.getTime()) / 86_400_000) }));
  }

  /** Positive balance = the customer owes us. */
  @Get('statement') @RequirePermissions('ledger.view')
  async statement(@Param('id', ParseUUIDPipe) id: string, @Query() q: StatementQuery, @CurrentUser() u: AuthUser) {
    const c = await this.customer(id, u);
    const from = q.from ? new Date(q.from) : undefined;
    const to = q.to ? new Date(q.to) : undefined;
    const before = from ? await this.prisma.ledgerEntry.aggregate({ where: { customerId: id, entryDate: { lt: from } }, _sum: { debit: true, credit: true } }) : null;
    const opening = c.openingBalance + (before?._sum.debit ?? 0) - (before?._sum.credit ?? 0);
    const rows = await this.prisma.ledgerEntry.findMany({
      where: { customerId: id, entryDate: { gte: from, lte: to } }, orderBy: [{ entryDate: 'asc' }, { createdAt: 'asc' }, { id: 'asc' }], take: 2000,
      select: { id: true, entryDate: true, entryType: true, debit: true, credit: true, description: true, referenceType: true, referenceId: true },
    });
    let running = opening;
    const entries = rows.map((r) => ({ ...r, balance: (running += r.debit - r.credit) }));
    return { customer: { id: c.id, code: c.code, name: c.name }, openingBalance: opening, entries, closingBalance: running, truncated: rows.length === 2000 };
  }
}

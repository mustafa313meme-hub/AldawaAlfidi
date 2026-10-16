import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { AllocatePaymentDto, CancelPaymentDto, CreatePaymentDto, PaymentsQuery, SummaryQuery } from './payments.dto';
import { PaymentsService } from './payments.service';

// Payments are never deleted or edited in place: cancel (reverse) and re-enter.
@Controller('payments')
export class PaymentsController {
  constructor(private payments: PaymentsService) {}

  @Get() @RequirePermissions('payments.view')
  list(@Query() q: PaymentsQuery, @CurrentUser() u: AuthUser) { return this.payments.list(q, u); }

  @Get('summary') @RequirePermissions('payments.view')
  summary(@Query() q: SummaryQuery, @CurrentUser() u: AuthUser) { return this.payments.summary(q, u); }

  @Get(':id') @RequirePermissions('payments.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.payments.get(id, u); }

  @Post() @RequirePermissions('payments.create')
  create(@Body() dto: CreatePaymentDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.payments.create(dto, u, ctx); }

  @Post(':id/allocate') @HttpCode(200) @RequirePermissions('payments.edit')
  allocate(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AllocatePaymentDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.payments.allocate(id, dto, u, ctx); }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('payments.cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @Body() dto: CancelPaymentDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.payments.cancel(id, dto, u, ctx); }
}

@Controller('accounting')
export class AccountingController {
  constructor(private payments: PaymentsService) {}

  /** Integrity check of invoices / payments / ledger. `ok: true` means the money books agree. */
  @Get('reconcile') @RequirePermissions('payments.edit', 'ledger.view')
  reconcile() { return this.payments.reconcile(); }
}

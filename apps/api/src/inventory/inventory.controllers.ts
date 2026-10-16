import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { BatchesQuery, CreateAdjustmentDto, CreatePurchaseDto, CreateTransferDto, ListQuery, PurchasesQuery, ReceivePurchaseDto, StocktakeDto, UpdatePurchaseDto } from './inventory.dto';
import { InventoryService } from './inventory.service';

// No DELETE anywhere: purchases are cancelled, stock is corrected by adjustments.
@Controller('purchases')
export class PurchasesController {
  constructor(private inv: InventoryService) {}

  @Get() @RequirePermissions('purchases.view')
  list(@Query() q: PurchasesQuery) { return this.inv.listPurchases(q); }

  @Get(':id') @RequirePermissions('purchases.view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.inv.getPurchase(id); }

  @Post() @RequirePermissions('purchases.create')
  create(@Body() dto: CreatePurchaseDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.inv.createPurchase(dto, u, ctx); }

  @Patch(':id') @RequirePermissions('purchases.create')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePurchaseDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.inv.updatePurchase(id, dto, u, ctx); }

  @Post(':id/order') @HttpCode(200) @RequirePermissions('purchases.create')
  order(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.inv.markOrdered(id, u, ctx); }

  @Post(':id/receive') @HttpCode(200) @RequirePermissions('purchases.receive')
  receive(@Param('id', ParseUUIDPipe) id: string, @Body() dto: ReceivePurchaseDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.inv.receivePurchase(id, dto, u, ctx); }

  @Post(':id/cancel') @HttpCode(200) @RequirePermissions('purchases.cancel')
  cancel(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.inv.cancelPurchase(id, u, ctx); }
}

@Controller('transfers')
export class TransfersController {
  constructor(private inv: InventoryService) {}

  @Get() @RequirePermissions('inventory.view')
  list(@Query() q: ListQuery) { return this.inv.listTransfers(q); }

  @Get(':id') @RequirePermissions('inventory.view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.inv.getTransfer(id); }

  @Post() @RequirePermissions('inventory.transfer')
  create(@Body() dto: CreateTransferDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.inv.createTransfer(dto, u, ctx); }
}

@Controller('adjustments')
export class AdjustmentsController {
  constructor(private inv: InventoryService) {}

  @Get() @RequirePermissions('inventory.view')
  list(@Query() q: ListQuery) { return this.inv.listAdjustments(q); }

  @Get(':id') @RequirePermissions('inventory.view')
  get(@Param('id', ParseUUIDPipe) id: string) { return this.inv.getAdjustment(id); }

  @Post() @RequirePermissions('inventory.adjust')
  create(@Body() dto: CreateAdjustmentDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.inv.createAdjustment(dto, u, ctx); }
}

@Controller('inventory')
export class InventoryController {
  constructor(private inv: InventoryService) {}

  @Get('batches') @RequirePermissions('inventory.view')
  batches(@Query() q: BatchesQuery, @CurrentUser() u: AuthUser) { return this.inv.batches(q, u); }

  @Get('batches/near-expiry') @RequirePermissions('inventory.view')
  near(@Query() q: BatchesQuery, @CurrentUser() u: AuthUser) { return this.inv.batches(q, u, 'near'); }

  @Get('batches/expired') @RequirePermissions('inventory.view')
  expired(@Query() q: BatchesQuery, @CurrentUser() u: AuthUser) { return this.inv.batches(q, u, 'expired'); }

  @Post('stocktake') @HttpCode(200) @RequirePermissions('inventory.adjust')
  stocktake(@Body() dto: StocktakeDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.inv.stocktake(dto, u, ctx); }

  /** Books integrity check (stock vs movements vs batches). */
  @Get('reconcile') @RequirePermissions('inventory.adjust')
  reconcile() { return this.inv.reconcile(); }
}

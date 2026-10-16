import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { CreateProductDto, ProductsQuery, UpdateProductDto } from './products.dto';
import { ProductsService } from './products.service';

// No DELETE: products are referenced by invoices and stock; deactivate with isActive=false.
@Controller('products')
export class ProductsController {
  constructor(private products: ProductsService) {}

  @Get() @RequirePermissions('products.view')
  list(@Query() q: ProductsQuery, @CurrentUser() u: AuthUser) { return this.products.list(q, u); }

  // Declared before ':id' so "by-barcode" is not parsed as an id.
  @Get('by-barcode/:barcode') @RequirePermissions('products.view')
  byBarcode(@Param('barcode') barcode: string, @CurrentUser() u: AuthUser) { return this.products.byBarcode(barcode, u); }

  @Get(':id') @RequirePermissions('products.view')
  get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) { return this.products.get(id, u); }

  @Post() @RequirePermissions('products.create')
  create(@Body() dto: CreateProductDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) { return this.products.create(dto, u, ctx); }

  @Patch(':id') @RequirePermissions('products.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateProductDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.products.update(id, dto, u, ctx);
  }
}

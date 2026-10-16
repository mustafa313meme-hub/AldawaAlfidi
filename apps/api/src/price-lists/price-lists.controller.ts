import { Body, Controller, Delete, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength, ValidateNested } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { PageQuery, skipTake } from '../common/pagination';
import { Message, Paginated } from '../common/response';
import { resolvePrice } from './pricing';

class CreatePriceListDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
}
class UpdatePriceListDto {
  @IsOptional() @IsString() @MinLength(2) @MaxLength(100) name?: string;
  @IsOptional() @IsString() @MaxLength(300) description?: string;
  @IsOptional() @IsBoolean() isDefault?: boolean;
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class ItemDto {
  @IsUUID() productId!: string;
  @IsInt() @Min(0) @Max(2_000_000_000) price!: number;
}
class SetItemsDto {
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => ItemDto) items!: ItemDto[];
}
class ResolveQuery {
  @IsUUID() productId!: string;
  @IsOptional() @IsUUID() priceListId?: string;
}

@Controller('price-lists')
export class PriceListsController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  @Get() @RequirePermissions('price_lists.view')
  list() {
    return this.prisma.priceList.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { items: true } } } });
  }

  /** Effective price for a product: given list → default list → product price. Declared before ':id'. */
  @Get('resolve') @RequirePermissions('price_lists.view', 'products.view_prices')
  async resolve(@Query() q: ResolveQuery) {
    const product = await this.prisma.product.findUnique({ where: { id: q.productId }, select: { id: true, salePrice: true } });
    if (!product) throw new AppException('NOT_FOUND', 'المنتج غير موجود', 404);
    const def = await this.prisma.priceList.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } });
    const [listItem, defItem] = await Promise.all([
      q.priceListId ? this.prisma.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: q.priceListId, productId: q.productId } } }) : null,
      def ? this.prisma.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: def.id, productId: q.productId } } }) : null,
    ]);
    return resolvePrice({ listPrice: listItem?.price, defaultListPrice: defItem?.price, productSalePrice: product.salePrice });
  }

  @Get(':id') @RequirePermissions('price_lists.view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const l = await this.prisma.priceList.findUnique({ where: { id }, include: { _count: { select: { items: true } } } });
    if (!l) throw new AppException('NOT_FOUND', 'قائمة الأسعار غير موجودة', 404);
    return l;
  }

  @Post() @RequirePermissions('price_lists.create')
  create(@Body() dto: CreatePriceListDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      if (dto.isDefault) await tx.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const l = await tx.priceList.create({ data: dto });
      await this.audit.log({ userId: u.id, action: 'price_lists.create', entity: 'price_list', entityId: l.id, newValues: l, ctx }, tx);
      return l;
    });
  }

  @Patch(':id') @RequirePermissions('price_lists.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdatePriceListDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.priceList.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND', 'قائمة الأسعار غير موجودة', 404);
      const willBeDefault = dto.isDefault ?? before.isDefault;
      if (before.isDefault && (dto.isActive === false || dto.isDefault === false)) {
        throw new AppException('DEFAULT_REQUIRED', 'لا يمكن تعطيل القائمة الافتراضية؛ عيّن قائمة أخرى افتراضية أولاً', 400);
      }
      if (dto.isDefault && !before.isDefault) await tx.priceList.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
      const after = await tx.priceList.update({ where: { id }, data: { ...dto, isDefault: willBeDefault } });
      await this.audit.log({ userId: u.id, action: 'price_lists.update', entity: 'price_list', entityId: id, oldValues: before, newValues: after, ctx }, tx);
      return after;
    });
  }

  @Get(':id/items') @RequirePermissions('price_lists.view')
  async items(@Param('id', ParseUUIDPipe) id: string, @Query() q: PageQuery) {
    const where = { priceListId: id };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.priceListItem.findMany({
        where, orderBy: { product: { nameAr: 'asc' } }, ...skipTake(q),
        select: { price: true, updatedAt: true, product: { select: { id: true, sku: true, nameAr: true, salePrice: true, minSalePrice: true } } },
      }),
      this.prisma.priceListItem.count({ where }),
    ]);
    return new Paginated(rows, { page: q.page, pageSize: q.pageSize, total });
  }

  /** Bulk upsert. Rule: a list price may not be below the product's minSalePrice. */
  @Put(':id/items') @RequirePermissions('price_lists.update')
  setItems(@Param('id', ParseUUIDPipe) id: string, @Body() dto: SetItemsDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    const ids = dto.items.map((i) => i.productId);
    if (new Set(ids).size !== ids.length) throw new AppException('DUPLICATE_ITEMS', 'منتج مكرر في الطلب', 400);
    return this.prisma.$transaction(async (tx) => {
      const list = await tx.priceList.findUnique({ where: { id } });
      if (!list) throw new AppException('NOT_FOUND', 'قائمة الأسعار غير موجودة', 404);
      const products = await tx.product.findMany({ where: { id: { in: ids } }, select: { id: true, isActive: true, minSalePrice: true, sku: true } });
      const byId = new Map(products.map((p) => [p.id, p]));
      const problems: { productId: string; reason: string }[] = [];
      for (const i of dto.items) {
        const p = byId.get(i.productId);
        if (!p) problems.push({ productId: i.productId, reason: 'غير موجود' });
        else if (!p.isActive) problems.push({ productId: i.productId, reason: 'منتج غير فعّال' });
        else if (i.price < p.minSalePrice) problems.push({ productId: i.productId, reason: `السعر أقل من الحد الأدنى (${p.minSalePrice})` });
      }
      if (problems.length) throw new AppException('INVALID_ITEMS', 'بعض الأسعار غير صالحة', 400, problems);

      const old = await tx.priceListItem.findMany({ where: { priceListId: id, productId: { in: ids } }, select: { productId: true, price: true } });
      await tx.priceListItem.deleteMany({ where: { priceListId: id, productId: { in: ids } } });
      await tx.priceListItem.createMany({ data: dto.items.map((i) => ({ priceListId: id, productId: i.productId, price: i.price })) });
      await this.audit.log({ userId: u.id, action: 'price_lists.items_changed', entity: 'price_list', entityId: id, oldValues: old, newValues: dto.items, ctx }, tx);
      return { updated: dto.items.length };
    });
  }

  @Delete(':id/items/:productId') @HttpCode(200) @RequirePermissions('price_lists.update')
  async removeItem(@Param('id', ParseUUIDPipe) id: string, @Param('productId', ParseUUIDPipe) productId: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    await this.prisma.$transaction(async (tx) => {
      const item = await tx.priceListItem.findUnique({ where: { priceListId_productId: { priceListId: id, productId } } });
      if (!item) throw new AppException('NOT_FOUND', 'السعر غير موجود في القائمة', 404);
      await tx.priceListItem.delete({ where: { priceListId_productId: { priceListId: id, productId } } });
      await this.audit.log({ userId: u.id, action: 'price_lists.item_removed', entity: 'price_list', entityId: id, oldValues: { productId, price: item.price }, ctx }, tx);
    });
    return new Message('تم حذف السعر من القائمة');
  }
}

import { Injectable } from '@nestjs/common';
import { Prisma, Product } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../sequence/sequence.service';
import { AppException } from '../common/app.exception';
import { AuthUser, ReqCtx } from '../common/decorators';
import { buildSearchText, normalizeSearch } from '../common/arabic';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { CreateProductDto, ProductsQuery, UpdateProductDto } from './products.dto';

const has = (u: AuthUser, perm: string) => u.isSuperAdmin || u.permissions.includes(perm);

/** Field-level visibility: cost needs products.view_cost, selling prices need products.view_prices. */
export function shapeProduct<T extends Partial<Product>>(p: T, u: AuthUser) {
  const { searchText: _s, ...rest } = p as T & { searchText?: string };
  const out: Record<string, unknown> = { ...rest };
  if (!has(u, 'products.view_cost')) {
    delete out.purchasePrice;
    delete out.minSalePrice;
  }
  if (!has(u, 'products.view_prices')) delete out.salePrice;
  return out;
}

const INCLUDE = {
  company: { select: { id: true, name: true } },
  category: { select: { id: true, name: true } },
} as const;

@Injectable()
export class ProductsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService) {}

  private async assertRefs(tx: Prisma.TransactionClient, companyId?: string, categoryId?: string | null) {
    if (companyId) {
      const c = await tx.company.findUnique({ where: { id: companyId } });
      if (!c || !c.isActive) throw new AppException('INVALID_COMPANY', 'الشركة غير موجودة أو غير فعّالة', 400);
    }
    if (categoryId) {
      const c = await tx.category.findUnique({ where: { id: categoryId } });
      if (!c || !c.isActive) throw new AppException('INVALID_CATEGORY', 'التصنيف غير موجود أو غير فعّال', 400);
    }
  }

  private assertPrices(sale: number, min: number) {
    if (min > sale) throw new AppException('INVALID_PRICES', 'الحد الأدنى للبيع يجب ألا يتجاوز سعر البيع', 400);
  }

  async list(q: ProductsQuery, u: AuthUser) {
    const terms = q.q ? normalizeSearch(q.q).split(' ').filter(Boolean) : [];
    const where: Prisma.ProductWhereInput = {
      companyId: q.companyId, categoryId: q.categoryId, isActive: q.isActive,
      ...(terms.length ? { AND: terms.map((t) => ({ searchText: { contains: t } })) } : {}),
    };
    const sortable = ['nameAr', 'sku', 'createdAt', ...(has(u, 'products.view_prices') ? ['salePrice'] : [])];
    const sort = q.sort && sortable.includes(q.sort) ? q.sort : 'nameAr';
    const [items, total] = await this.prisma.$transaction([
      this.prisma.product.findMany({ where, include: INCLUDE, orderBy: { [sort]: q.sort ? q.order : 'asc' }, ...skipTake(q) }),
      this.prisma.product.count({ where }),
    ]);
    return new Paginated(items.map((p) => shapeProduct(p, u)), { page: q.page, pageSize: q.pageSize, total });
  }

  async get(id: string, u: AuthUser) {
    const p = await this.prisma.product.findUnique({ where: { id }, include: INCLUDE });
    if (!p) throw new AppException('NOT_FOUND', 'المنتج غير موجود', 404);
    return shapeProduct(p, u);
  }

  async byBarcode(barcode: string, u: AuthUser) {
    const p = await this.prisma.product.findUnique({ where: { barcode }, include: INCLUDE });
    if (!p) throw new AppException('NOT_FOUND', 'لا يوجد منتج بهذا الباركود', 404);
    return shapeProduct(p, u);
  }

  create(dto: CreateProductDto, u: AuthUser, ctx: ReqCtx) {
    this.assertPrices(dto.salePrice, dto.minSalePrice ?? 0);
    return this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, dto.companyId, dto.categoryId);
      const sku = dto.sku ?? `P-${String(await this.seq.next('product', tx)).padStart(6, '0')}`;
      const p = await tx.product.create({
        data: { ...dto, sku, categoryId: dto.categoryId ?? null, searchText: buildSearchText(dto.nameAr, dto.nameEn, dto.genericName, sku, dto.barcode) },
        include: INCLUDE,
      });
      await this.audit.log({ userId: u.id, action: 'products.create', entity: 'product', entityId: p.id, newValues: p, ctx }, tx);
      return shapeProduct(p, u);
    });
  }

  update(id: string, dto: UpdateProductDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.product.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND', 'المنتج غير موجود', 404);
      const priceChanged = (dto.salePrice !== undefined && dto.salePrice !== before.salePrice)
        || (dto.purchasePrice !== undefined && dto.purchasePrice !== before.purchasePrice)
        || (dto.minSalePrice !== undefined && dto.minSalePrice !== before.minSalePrice);
      // Changing prices is its own permission-controlled action: view_cost implies price management here.
      if (priceChanged && !has(u, 'products.view_cost')) {
        throw new AppException('FORBIDDEN', 'تعديل الأسعار يتطلب صلاحية الأسعار والتكلفة', 403);
      }
      this.assertPrices(dto.salePrice ?? before.salePrice, dto.minSalePrice ?? before.minSalePrice);
      await this.assertRefs(tx, dto.companyId && dto.companyId !== before.companyId ? dto.companyId : undefined,
        dto.categoryId && dto.categoryId !== before.categoryId ? dto.categoryId : undefined);

      const m = { ...before, ...dto };
      const after = await tx.product.update({
        where: { id }, include: INCLUDE,
        data: { ...dto, searchText: buildSearchText(m.nameAr, m.nameEn, m.genericName, before.sku, m.barcode) },
      });
      const action = dto.isActive === false ? 'products.deactivate' : priceChanged ? 'products.price_change' : 'products.update';
      await this.audit.log({ userId: u.id, action, entity: 'product', entityId: id, oldValues: before, newValues: after, ctx }, tx);
      return shapeProduct(after, u);
    });
  }
}

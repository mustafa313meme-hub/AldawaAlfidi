import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { MAX_CATEGORY_DEPTH, depthOf, wouldCreateCycle } from './category-tree';

class CreateCategoryDto {
  @IsString() @MinLength(1) @MaxLength(100) name!: string;
  @IsOptional() @IsUUID() parentId?: string | null;
}
class UpdateCategoryDto {
  @IsOptional() @IsString() @MinLength(1) @MaxLength(100) name?: string;
  @IsOptional() @IsUUID() parentId?: string | null;
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('categories')
export class CategoriesController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  /** Flat list (parentId on each row); the client builds the tree. Categories are few, so no pagination. */
  @Get() @RequirePermissions('categories.view')
  list() {
    return this.prisma.category.findMany({ orderBy: { name: 'asc' } });
  }

  @Get(':id') @RequirePermissions('categories.view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const c = await this.prisma.category.findUnique({ where: { id } });
    if (!c) throw new AppException('NOT_FOUND', 'التصنيف غير موجود', 404);
    return c;
  }

  private async parentMap(tx: Prisma.TransactionClient) {
    const all = await tx.category.findMany({ select: { id: true, parentId: true } });
    return new Map(all.map((c) => [c.id, c.parentId]));
  }

  private async assertSiblingNameFree(tx: Prisma.TransactionClient, name: string, parentId: string | null, exceptId?: string) {
    const dup = await tx.category.findFirst({ where: { name, parentId, id: exceptId ? { not: exceptId } : undefined } });
    if (dup) throw new AppException('CONFLICT', 'يوجد تصنيف بنفس الاسم ضمن نفس المستوى', 409);
  }

  @Post() @RequirePermissions('categories.create')
  create(@Body() dto: CreateCategoryDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const parentId = dto.parentId ?? null;
      if (parentId) {
        const map = await this.parentMap(tx);
        if (!map.has(parentId)) throw new AppException('NOT_FOUND', 'التصنيف الأب غير موجود', 404);
        if (depthOf(map, parentId) >= MAX_CATEGORY_DEPTH) throw new AppException('MAX_DEPTH', `الحد الأقصى ${MAX_CATEGORY_DEPTH} مستويات`, 400);
      }
      await this.assertSiblingNameFree(tx, dto.name, parentId);
      const c = await tx.category.create({ data: { name: dto.name, parentId } });
      await this.audit.log({ userId: u.id, action: 'categories.create', entity: 'category', entityId: c.id, newValues: c, ctx }, tx);
      return c;
    });
  }

  @Patch(':id') @RequirePermissions('categories.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateCategoryDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.category.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND', 'التصنيف غير موجود', 404);
      const parentId = dto.parentId === undefined ? before.parentId : dto.parentId;
      if (dto.parentId !== undefined && parentId !== before.parentId) {
        const map = await this.parentMap(tx);
        if (parentId && !map.has(parentId)) throw new AppException('NOT_FOUND', 'التصنيف الأب غير موجود', 404);
        if (wouldCreateCycle(map, id, parentId)) throw new AppException('CATEGORY_CYCLE', 'لا يمكن جعل التصنيف أباً لنفسه أو لأحد فروعه', 400);
        if (parentId && depthOf(map, parentId) >= MAX_CATEGORY_DEPTH) throw new AppException('MAX_DEPTH', `الحد الأقصى ${MAX_CATEGORY_DEPTH} مستويات`, 400);
      }
      await this.assertSiblingNameFree(tx, dto.name ?? before.name, parentId, id);
      const after = await tx.category.update({ where: { id }, data: { name: dto.name, parentId, isActive: dto.isActive } });
      await this.audit.log({ userId: u.id, action: 'categories.update', entity: 'category', entityId: id, oldValues: before, newValues: after, ctx }, tx);
      return after;
    });
  }
}

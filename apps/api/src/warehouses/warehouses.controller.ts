import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { IsBoolean, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { PartialType } from '@nestjs/mapped-types';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../sequence/sequence.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';

class CreateWarehouseDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{2,20}$/) code?: string;
  @IsOptional() @IsString() @MaxLength(300) location?: string;
  @IsOptional() @IsUUID() managerId?: string | null;
}
class UpdateWarehouseDto extends PartialType(CreateWarehouseDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}

@Controller('warehouses')
export class WarehousesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService) {}

  private include = { manager: { select: { id: true, fullName: true } } } as const;

  @Get() @RequirePermissions('warehouses.view')
  list() {
    return this.prisma.warehouse.findMany({ orderBy: { name: 'asc' }, include: this.include });
  }

  @Get(':id') @RequirePermissions('warehouses.view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const w = await this.prisma.warehouse.findUnique({ where: { id }, include: this.include });
    if (!w) throw new AppException('NOT_FOUND', 'المخزن غير موجود', 404);
    return w;
  }

  private async assertManager(tx: Prisma.TransactionClient, managerId?: string | null) {
    if (!managerId) return;
    const m = await tx.user.findFirst({ where: { id: managerId, isActive: true, deletedAt: null } });
    if (!m) throw new AppException('INVALID_MANAGER', 'مدير المخزن غير موجود أو غير فعّال', 400);
  }

  @Post() @RequirePermissions('warehouses.create')
  create(@Body() dto: CreateWarehouseDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertManager(tx, dto.managerId);
      const code = dto.code ?? `WH-${String(await this.seq.next('warehouse', tx)).padStart(3, '0')}`;
      const w = await tx.warehouse.create({ data: { name: dto.name, code, location: dto.location, managerId: dto.managerId ?? null }, include: this.include });
      await this.audit.log({ userId: u.id, action: 'warehouses.create', entity: 'warehouse', entityId: w.id, newValues: w, ctx }, tx);
      return w;
    });
  }

  @Patch(':id') @RequirePermissions('warehouses.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateWarehouseDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.warehouse.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND', 'المخزن غير موجود', 404);
      await this.assertManager(tx, dto.managerId);
      const after = await tx.warehouse.update({
        where: { id }, include: this.include,
        data: { name: dto.name, code: dto.code, location: dto.location, managerId: dto.managerId, isActive: dto.isActive },
      });
      await this.audit.log({ userId: u.id, action: dto.isActive === false ? 'warehouses.deactivate' : 'warehouses.update', entity: 'warehouse', entityId: id, oldValues: before, newValues: after, ctx }, tx);
      return after;
    });
  }
}

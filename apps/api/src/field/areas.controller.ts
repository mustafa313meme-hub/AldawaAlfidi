import { Body, Controller, Get, HttpCode, Param, ParseUUIDPipe, Patch, Post } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { IsBoolean, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min, MinLength } from 'class-validator';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { Message } from '../common/response';

class CreateAreaDto {
  @IsString() @MinLength(2) @MaxLength(100) name!: string;
  @IsString() @MinLength(2) @MaxLength(100) city!: string;
  @IsOptional() @IsString() @MaxLength(100) district?: string;
  @IsOptional() @IsString() @MaxLength(500) description?: string;
}
class UpdateAreaDto extends PartialType(CreateAreaDto) {
  @IsOptional() @IsBoolean() isActive?: boolean;
}
class AssignAreaDto {
  @IsUUID() representativeId!: string;
  @IsOptional() @IsInt() @Min(1) @Max(100) priority?: number;
}
class TransferAreaDto {
  @IsUUID() toRepresentativeId!: string;
  /** Also move this area's customers that are currently assigned to the previous representative. */
  @IsOptional() @IsBoolean() moveCustomers?: boolean;
}

// No DELETE: areas are referenced by customers and assignment history; use isActive=false.
@Controller('areas')
export class AreasController {
  constructor(private prisma: PrismaService, private audit: AuditService) {}

  private current = {
    reps: { where: { activeTo: null }, take: 1, select: { priority: true, activeFrom: true, representative: { select: { id: true, fullName: true, employeeCode: true } } } },
  } as const;

  private shape<T extends { reps: Array<{ priority: number; activeFrom: Date; representative: unknown }> }>(a: T) {
    const { reps, ...rest } = a;
    return { ...rest, responsible: reps[0] ? { ...(reps[0].representative as object), priority: reps[0].priority, since: reps[0].activeFrom } : null };
  }

  @Get() @RequirePermissions('areas.view')
  async list() {
    const rows = await this.prisma.area.findMany({ orderBy: [{ city: 'asc' }, { name: 'asc' }], include: this.current });
    return rows.map((a) => this.shape(a));
  }

  @Get(':id') @RequirePermissions('areas.view')
  async get(@Param('id', ParseUUIDPipe) id: string) {
    const a = await this.prisma.area.findUnique({ where: { id }, include: this.current });
    if (!a) throw new AppException('NOT_FOUND', 'المنطقة غير موجودة', 404);
    return this.shape(a);
  }

  @Get(':id/history') @RequirePermissions('areas.view')
  history(@Param('id', ParseUUIDPipe) id: string) {
    return this.prisma.representativeArea.findMany({
      where: { areaId: id }, orderBy: { activeFrom: 'desc' },
      select: { id: true, priority: true, activeFrom: true, activeTo: true, representative: { select: { id: true, fullName: true } } },
    });
  }

  @Post() @RequirePermissions('areas.create')
  create(@Body() dto: CreateAreaDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const a = await tx.area.create({ data: dto });
      await this.audit.log({ userId: u.id, action: 'areas.create', entity: 'area', entityId: a.id, newValues: a, ctx }, tx);
      return a;
    });
  }

  @Patch(':id') @RequirePermissions('areas.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateAreaDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.area.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND', 'المنطقة غير موجودة', 404);
      const after = await tx.area.update({ where: { id }, data: dto });
      await this.audit.log({ userId: u.id, action: dto.isActive === false ? 'areas.deactivate' : 'areas.update', entity: 'area', entityId: id, oldValues: before, newValues: after, ctx }, tx);
      return after;
    });
  }

  @Post(':id/assign') @RequirePermissions('areas.assign')
  assign(@Param('id', ParseUUIDPipe) id: string, @Body() dto: AssignAreaDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const [area, rep, open] = await Promise.all([
        tx.area.findUnique({ where: { id } }),
        tx.representative.findUnique({ where: { id: dto.representativeId } }),
        tx.representativeArea.findFirst({ where: { areaId: id, activeTo: null } }),
      ]);
      if (!area || !area.isActive) throw new AppException('NOT_FOUND', 'المنطقة غير موجودة أو معطّلة', 404);
      if (!rep || rep.status !== 'Active') throw new AppException('INVALID_REP', 'المندوب غير موجود أو غير فعّال', 400);
      if (open) throw new AppException('AREA_ALREADY_ASSIGNED', 'المنطقة مسندة لمندوب؛ استخدم النقل (transfer)', 409);
      const row = await tx.representativeArea.create({ data: { areaId: id, representativeId: rep.id, priority: dto.priority ?? 1 } });
      await this.audit.log({ userId: u.id, action: 'areas.assign', entity: 'area', entityId: id, newValues: { representativeId: rep.id }, ctx }, tx);
      return row;
    });
  }

  @Post(':id/transfer') @RequirePermissions('areas.assign')
  transfer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferAreaDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const open = await tx.representativeArea.findFirst({ where: { areaId: id, activeTo: null } });
      if (!open) throw new AppException('AREA_NOT_ASSIGNED', 'المنطقة غير مسندة لأي مندوب', 400);
      if (open.representativeId === dto.toRepresentativeId) throw new AppException('SAME_REP', 'المنطقة مسندة لهذا المندوب مسبقاً', 400);
      const to = await tx.representative.findUnique({ where: { id: dto.toRepresentativeId } });
      if (!to || to.status !== 'Active') throw new AppException('INVALID_REP', 'المندوب الهدف غير موجود أو غير فعّال', 400);

      const now = new Date();
      await tx.representativeArea.update({ where: { id: open.id }, data: { activeTo: now } });
      await tx.representativeArea.create({ data: { areaId: id, representativeId: to.id, priority: open.priority, activeFrom: now } });

      let moved = 0;
      if (dto.moveCustomers) {
        const links = await tx.customerRepresentative.findMany({
          where: { representativeId: open.representativeId, assignedTo: null, isPrimary: true, customer: { areaId: id } },
          select: { id: true, customerId: true },
        });
        if (links.length) {
          await tx.customerRepresentative.updateMany({ where: { id: { in: links.map((l) => l.id) } }, data: { assignedTo: now } });
          await tx.customerRepresentative.createMany({ data: links.map((l) => ({ customerId: l.customerId, representativeId: to.id, assignedFrom: now, isPrimary: true })) });
        }
        moved = links.length;
      }
      await this.audit.log({
        userId: u.id, action: 'areas.transfer', entity: 'area', entityId: id,
        oldValues: { representativeId: open.representativeId }, newValues: { representativeId: to.id, customersMoved: moved }, ctx,
      }, tx);
      return { customersMoved: moved };
    });
  }

  @Post(':id/unassign') @HttpCode(200) @RequirePermissions('areas.assign')
  async unassign(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    await this.prisma.$transaction(async (tx) => {
      const open = await tx.representativeArea.findFirst({ where: { areaId: id, activeTo: null } });
      if (!open) throw new AppException('AREA_NOT_ASSIGNED', 'المنطقة غير مسندة لأي مندوب', 400);
      await tx.representativeArea.update({ where: { id: open.id }, data: { activeTo: new Date() } });
      await this.audit.log({ userId: u.id, action: 'areas.unassign', entity: 'area', entityId: id, oldValues: { representativeId: open.representativeId }, ctx }, tx);
    });
    return new Message('تم إلغاء إسناد المنطقة');
  }
}

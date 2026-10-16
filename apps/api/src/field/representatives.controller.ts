import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { Transform } from 'class-transformer';
import { IsDateString, IsEnum, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength } from 'class-validator';
import { Prisma, RepStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../sequence/sequence.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { can } from '../common/perm';
import { PageQuery, skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { normalizeSearch } from '../common/arabic';

class CreateRepDto {
  @IsOptional() @Matches(/^[A-Za-z0-9_-]{2,20}$/) employeeCode?: string;
  @IsString() @MinLength(2) @MaxLength(150) fullName!: string;
  @IsOptional() @Matches(/^\+?[0-9]{7,15}$/) phone?: string;
  @IsOptional() @IsString() @MaxLength(300) address?: string;
  @IsOptional() @IsString() @MaxLength(30) nationalId?: string;
  @IsOptional() @IsDateString() hireDate?: string;
  @IsOptional() @IsUUID() userId?: string | null;
  @IsOptional() @IsUUID() supervisorId?: string | null;
  @IsOptional() @IsString() @MaxLength(1000) notes?: string;
}
class UpdateRepDto extends PartialType(CreateRepDto) {
  @IsOptional() @IsEnum(RepStatus) status?: RepStatus;
}
class RepsQuery extends PageQuery {
  @IsOptional() @IsString() @MaxLength(100) q?: string;
  @IsOptional() @IsEnum(RepStatus) status?: RepStatus;
}
class TransferCustomersDto {
  @IsUUID() toRepresentativeId!: string;
  @IsOptional() @IsUUID() areaId?: string;
}

@Controller('representatives')
export class RepresentativesController {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService) {}

  // nationalId is only returned to users who can edit representatives.
  private shape<T extends { nationalId?: string | null }>(r: T, u: AuthUser) {
    const out: Record<string, unknown> = { ...r };
    if (!can(u, 'representatives.update')) delete out.nationalId;
    return out;
  }

  private include = {
    user: { select: { id: true, username: true, isActive: true } },
    supervisor: { select: { id: true, fullName: true } },
  } as const;

  private async assertUsers(tx: Prisma.TransactionClient, userId?: string | null, supervisorId?: string | null, selfId?: string) {
    if (userId) {
      const user = await tx.user.findFirst({ where: { id: userId, isActive: true, deletedAt: null } });
      if (!user) throw new AppException('INVALID_USER', 'المستخدم المرتبط غير موجود أو غير فعّال', 400);
      const taken = await tx.representative.findFirst({ where: { userId, id: selfId ? { not: selfId } : undefined } });
      if (taken) throw new AppException('USER_ALREADY_LINKED', 'هذا المستخدم مرتبط بمندوب آخر', 409);
    }
    if (supervisorId) {
      const sup = await tx.user.findFirst({ where: { id: supervisorId, isActive: true, deletedAt: null } });
      if (!sup) throw new AppException('INVALID_SUPERVISOR', 'المشرف غير موجود أو غير فعّال', 400);
    }
  }

  @Get() @RequirePermissions('representatives.view')
  async list(@Query() q: RepsQuery, @CurrentUser() u: AuthUser) {
    const where: Prisma.RepresentativeWhereInput = {
      status: q.status,
      ...(q.q ? { OR: [{ fullName: { contains: q.q, mode: 'insensitive' } }, { employeeCode: { contains: q.q, mode: 'insensitive' } }, { phone: { contains: q.q } }] } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.representative.findMany({ where, include: this.include, orderBy: { fullName: 'asc' }, ...skipTake(q) }),
      this.prisma.representative.count({ where }),
    ]);
    return new Paginated(items.map((r) => this.shape(r, u)), { page: q.page, pageSize: q.pageSize, total });
  }

  @Get(':id') @RequirePermissions('representatives.view')
  async get(@Param('id', ParseUUIDPipe) id: string, @CurrentUser() u: AuthUser) {
    const r = await this.prisma.representative.findUnique({ where: { id }, include: this.include });
    if (!r) throw new AppException('NOT_FOUND', 'المندوب غير موجود', 404);
    const [areas, customers] = await Promise.all([
      this.prisma.representativeArea.findMany({ where: { representativeId: id, activeTo: null }, include: { area: { select: { id: true, name: true, city: true } } }, orderBy: { priority: 'asc' } }),
      this.prisma.customerRepresentative.count({ where: { representativeId: id, assignedTo: null } }),
    ]);
    return { ...this.shape(r, u), activeAreas: areas, activeCustomersCount: customers };
  }

  @Post() @RequirePermissions('representatives.create')
  create(@Body() dto: CreateRepDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      await this.assertUsers(tx, dto.userId, dto.supervisorId);
      const employeeCode = dto.employeeCode ?? `R-${String(await this.seq.next('representative', tx)).padStart(4, '0')}`;
      const r = await tx.representative.create({
        data: { ...dto, employeeCode, hireDate: dto.hireDate ? new Date(dto.hireDate) : undefined, userId: dto.userId ?? null, supervisorId: dto.supervisorId ?? null },
        include: this.include,
      });
      await this.audit.log({ userId: u.id, action: 'representatives.create', entity: 'representative', entityId: r.id, newValues: r, ctx }, tx);
      return this.shape(r, u);
    });
  }

  @Patch(':id') @RequirePermissions('representatives.update')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateRepDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.representative.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND', 'المندوب غير موجود', 404);
      await this.assertUsers(tx, dto.userId && dto.userId !== before.userId ? dto.userId : undefined, dto.supervisorId, id);
      const { employeeCode: _ec, hireDate, ...rest } = dto;
      const after = await tx.representative.update({
        where: { id }, include: this.include,
        data: { ...rest, hireDate: hireDate ? new Date(hireDate) : undefined },
      });
      const statusChanged = dto.status && dto.status !== before.status;
      await this.audit.log({
        userId: u.id, action: statusChanged ? 'representatives.status_change' : 'representatives.update',
        entity: 'representative', entityId: id, oldValues: before, newValues: after, ctx,
      }, tx);
      return this.shape(after, u);
    });
  }

  /** Moves every open primary customer assignment (optionally only one area's) from this rep to another. History is kept. */
  @Post(':id/transfer-customers') @RequirePermissions('customers.assign')
  transfer(@Param('id', ParseUUIDPipe) id: string, @Body() dto: TransferCustomersDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    if (dto.toRepresentativeId === id) throw new AppException('SAME_REP', 'المندوب المصدر والهدف متطابقان', 400);
    return this.prisma.$transaction(async (tx) => {
      const [from, to] = await Promise.all([tx.representative.findUnique({ where: { id } }), tx.representative.findUnique({ where: { id: dto.toRepresentativeId } })]);
      if (!from) throw new AppException('NOT_FOUND', 'المندوب غير موجود', 404);
      if (!to || to.status !== 'Active') throw new AppException('INVALID_TARGET_REP', 'المندوب الهدف غير موجود أو غير فعّال', 400);
      const links = await tx.customerRepresentative.findMany({
        where: { representativeId: id, assignedTo: null, isPrimary: true, ...(dto.areaId ? { customer: { areaId: dto.areaId } } : {}) },
        select: { id: true, customerId: true },
      });
      const now = new Date();
      if (links.length) {
        await tx.customerRepresentative.updateMany({ where: { id: { in: links.map((l) => l.id) } }, data: { assignedTo: now } });
        await tx.customerRepresentative.createMany({ data: links.map((l) => ({ customerId: l.customerId, representativeId: to.id, assignedFrom: now, isPrimary: true })) });
      }
      await this.audit.log({
        userId: u.id, action: 'customers.bulk_transfer', entity: 'representative', entityId: id,
        newValues: { to: to.id, areaId: dto.areaId ?? null, count: links.length, customerIds: links.slice(0, 500).map((l) => l.customerId) }, ctx,
      }, tx);
      return { transferred: links.length };
    });
  }
}

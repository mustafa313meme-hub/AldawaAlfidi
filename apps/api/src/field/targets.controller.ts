import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { PartialType } from '@nestjs/mapped-types';
import { IsDateString, IsEnum, IsInt, IsOptional, IsString, IsUUID, Max, MaxLength, Min } from 'class-validator';
import { TargetPeriod } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { can } from '../common/perm';
import { PageQuery, skipTake } from '../common/pagination';
import { Paginated } from '../common/response';

class CreateTargetDto {
  @IsUUID() representativeId!: string;
  @IsEnum(TargetPeriod) periodType!: TargetPeriod;
  @IsDateString() startDate!: string;
  @IsDateString() endDate!: string;
  @IsOptional() @IsInt() @Min(0) @Max(2_000_000_000) targetAmount?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) targetVisits?: number;
  @IsOptional() @IsInt() @Min(0) @Max(100000) targetOrders?: number;
  @IsOptional() @IsString() @MaxLength(500) notes?: string;
}
class UpdateTargetDto extends PartialType(CreateTargetDto) {}
class TargetsQuery extends PageQuery {
  @IsOptional() @IsUUID() representativeId?: string;
}

const day = (s: string) => new Date(s.slice(0, 10));

/** Targets only. Actual vs target (Achievement %) needs orders/invoices and arrives with Phase 4/7. */
@Controller('sales-targets')
export class TargetsController {
  constructor(private prisma: PrismaService, private audit: AuditService, private scope: ScopeService) {}

  @Get() @RequirePermissions('targets.view')
  async list(@Query() q: TargetsQuery, @CurrentUser() u: AuthUser) {
    let representativeId = q.representativeId;
    if (!can(u, 'targets.manage')) {
      const rep = await this.scope.repOf(u);
      if (!rep) return new Paginated([], { page: q.page, pageSize: q.pageSize, total: 0 });
      representativeId = rep.id;
    }
    const where = { representativeId };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.salesTarget.findMany({ where, orderBy: { startDate: 'desc' }, include: { representative: { select: { id: true, fullName: true } } }, ...skipTake(q) }),
      this.prisma.salesTarget.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  private assertRange(start: Date, end: Date) {
    if (end < start) throw new AppException('INVALID_RANGE', 'تاريخ النهاية قبل البداية', 400);
  }

  @Post() @RequirePermissions('targets.manage')
  create(@Body() dto: CreateTargetDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    const startDate = day(dto.startDate), endDate = day(dto.endDate);
    this.assertRange(startDate, endDate);
    return this.prisma.$transaction(async (tx) => {
      const rep = await tx.representative.findUnique({ where: { id: dto.representativeId } });
      if (!rep) throw new AppException('NOT_FOUND', 'المندوب غير موجود', 404);
      const t = await tx.salesTarget.create({ data: { ...dto, startDate, endDate } });
      await this.audit.log({ userId: u.id, action: 'targets.create', entity: 'sales_target', entityId: t.id, newValues: t, ctx }, tx);
      return t;
    });
  }

  @Patch(':id') @RequirePermissions('targets.manage')
  update(@Param('id', ParseUUIDPipe) id: string, @Body() dto: UpdateTargetDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.salesTarget.findUnique({ where: { id } });
      if (!before) throw new AppException('NOT_FOUND', 'الهدف غير موجود', 404);
      const startDate = dto.startDate ? day(dto.startDate) : before.startDate;
      const endDate = dto.endDate ? day(dto.endDate) : before.endDate;
      this.assertRange(startDate, endDate);
      const after = await tx.salesTarget.update({ where: { id }, data: { ...dto, startDate, endDate } });
      await this.audit.log({ userId: u.id, action: 'targets.update', entity: 'sales_target', entityId: id, oldValues: before, newValues: after, ctx }, tx);
      return after;
    });
  }
}

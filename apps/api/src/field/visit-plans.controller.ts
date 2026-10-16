import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Put, Query } from '@nestjs/common';
import { Type } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsDateString, IsEnum, IsInt, IsOptional, IsUUID, Max, Min, ValidateNested } from 'class-validator';
import { PlanStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser, Ctx, CurrentUser, ReqCtx, RequirePermissions } from '../common/decorators';
import { can } from '../common/perm';

class PlanQuery {
  @IsDateString() date!: string;
  @IsOptional() @IsUUID() representativeId?: string;
}
class PlanItemDto {
  @IsUUID() customerId!: string;
  @IsOptional() @IsInt() @Min(0) @Max(10) priority?: number;
}
class SetDayPlanDto {
  @IsUUID() representativeId!: string;
  @IsDateString() date!: string;
  @IsArray() @ArrayMaxSize(200) @ValidateNested({ each: true }) @Type(() => PlanItemDto) items!: PlanItemDto[];
}
class PlanStatusDto {
  @IsEnum(PlanStatus) status!: PlanStatus;
}

const day = (s: string) => new Date(s.slice(0, 10));

@Controller('visit-plans')
export class VisitPlansController {
  constructor(private prisma: PrismaService, private audit: AuditService, private scope: ScopeService) {}

  /** The rep's day: ordered customers with last-visit date. (Balance/last order join in with Phase 4-6.) */
  @Get() @RequirePermissions('visit_plans.view')
  async list(@Query() q: PlanQuery, @CurrentUser() u: AuthUser) {
    let repId = q.representativeId;
    if (!can(u, 'visit_plans.manage')) {
      const rep = await this.scope.repOf(u);
      if (!rep) return [];
      repId = rep.id;
    }
    if (!repId) throw new AppException('REP_REQUIRED', 'حدّد المندوب', 400);
    const plans = await this.prisma.visitPlan.findMany({
      where: { representativeId: repId, planDate: day(q.date) }, orderBy: { plannedOrder: 'asc' },
      include: { customer: { select: { id: true, code: true, name: true, phone: true, address: true, latitude: true, longitude: true, openingBalance: true } } },
    });
    const last = plans.length
      ? await this.prisma.visit.groupBy({ by: ['customerId'], where: { customerId: { in: plans.map((p) => p.customerId) } }, _max: { visitDate: true } })
      : [];
    const lastBy = new Map(last.map((l) => [l.customerId, l._max.visitDate]));
    return plans.map((p) => ({
      id: p.id, plannedOrder: p.plannedOrder, priority: p.priority, status: p.status, visitId: p.visitId,
      customer: p.customer, lastVisitDate: lastBy.get(p.customerId) ?? null,
    }));
  }

  /** Replaces the day's still-open plan; entries already Done are kept. Only the rep's own assigned customers are allowed. */
  @Put('day') @RequirePermissions('visit_plans.manage')
  setDay(@Body() dto: SetDayPlanDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    const ids = dto.items.map((i) => i.customerId);
    if (new Set(ids).size !== ids.length) throw new AppException('DUPLICATE_ITEMS', 'عميل مكرر في الخطة', 400);
    const planDate = day(dto.date);
    return this.prisma.$transaction(async (tx) => {
      const rep = await tx.representative.findUnique({ where: { id: dto.representativeId } });
      if (!rep || rep.status !== 'Active') throw new AppException('REP_NOT_ACTIVE', 'المندوب غير فعّال', 400);
      const assigned = await tx.customerRepresentative.findMany({ where: { representativeId: rep.id, assignedTo: null, customerId: { in: ids } }, select: { customerId: true } });
      const ok = new Set(assigned.map((a) => a.customerId));
      const bad = ids.filter((i) => !ok.has(i));
      if (bad.length) throw new AppException('CUSTOMER_NOT_ASSIGNED', 'بعض العملاء غير مسندين لهذا المندوب', 400, bad);

      const done = await tx.visitPlan.findMany({ where: { representativeId: rep.id, planDate, status: 'Done' }, select: { customerId: true } });
      const doneSet = new Set(done.map((d) => d.customerId));
      const old = await tx.visitPlan.findMany({ where: { representativeId: rep.id, planDate, status: { not: 'Done' } }, select: { customerId: true, plannedOrder: true, status: true } });
      await tx.visitPlan.deleteMany({ where: { representativeId: rep.id, planDate, status: { not: 'Done' } } });
      const fresh = dto.items.filter((i) => !doneSet.has(i.customerId));
      await tx.visitPlan.createMany({
        data: fresh.map((i, idx) => ({ representativeId: rep.id, planDate, customerId: i.customerId, priority: i.priority ?? 0, plannedOrder: doneSet.size + idx + 1 })),
      });
      await this.audit.log({ userId: u.id, action: 'visit_plans.set_day', entity: 'visit_plan', entityId: rep.id, oldValues: { date: dto.date, items: old }, newValues: { date: dto.date, items: fresh }, ctx }, tx);
      return { planned: fresh.length, keptDone: doneSet.size };
    });
  }

  /** Managers may set any status; the owning rep may only mark an entry Skipped. */
  @Patch(':id/status') @RequirePermissions('visit_plans.view')
  async setStatus(@Param('id', ParseUUIDPipe) id: string, @Body() dto: PlanStatusDto, @CurrentUser() u: AuthUser, @Ctx() ctx: ReqCtx) {
    const plan = await this.prisma.visitPlan.findUnique({ where: { id } });
    if (!plan) throw new AppException('NOT_FOUND', 'عنصر الخطة غير موجود', 404);
    if (!can(u, 'visit_plans.manage')) {
      const rep = await this.scope.repOf(u);
      if (!rep || rep.id !== plan.representativeId) throw new AppException('NOT_FOUND', 'عنصر الخطة غير موجود', 404);
      if (dto.status !== 'Skipped') throw new AppException('FORBIDDEN', 'يمكنك فقط تخطّي الزيارة', 403);
    }
    if (plan.status === 'Done') throw new AppException('PLAN_DONE', 'الزيارة منجزة ولا يمكن تغيير حالتها', 400);
    if (dto.status === 'Done') throw new AppException('PLAN_DONE_VIA_VISIT', 'تُنجَز الزيارة بتسجيل زيارة فعلية', 400);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.visitPlan.update({ where: { id }, data: { status: dto.status } });
      await this.audit.log({ userId: u.id, action: 'visit_plans.status', entity: 'visit_plan', entityId: id, oldValues: { status: plan.status }, newValues: { status: after.status }, ctx }, tx);
      return after;
    });
  }
}

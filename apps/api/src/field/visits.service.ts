import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser, ReqCtx } from '../common/decorators';
import { DEFAULT_SETTINGS } from '../common/permissions.constants';
import { can, localDate } from '../common/perm';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { CreateVisitDto, UpdateVisitDto, VisitsQuery } from './visits.dto';
import { evaluateVisitLocation } from './visit-location';

const MAX_FUTURE_MS = 5 * 60_000;
const MAX_AGE_MS = 30 * 86_400_000; // offline devices may sync late, but not unboundedly
const EDIT_WINDOW_MS = 24 * 3_600_000;

const INCLUDE = {
  customer: { select: { id: true, code: true, name: true } },
  representative: { select: { id: true, fullName: true } },
} as const;

@Injectable()
export class VisitsService {
  constructor(private prisma: PrismaService, private audit: AuditService, private scope: ScopeService) {}

  private async settings() {
    const rows = await this.prisma.setting.findMany({
      where: { key: { in: ['require_location_for_visit', 'visit_max_accuracy_m', 'visit_max_distance_m', 'visit_block_when_far'] } },
    });
    const m: Record<string, unknown> = { ...DEFAULT_SETTINGS };
    for (const r of rows) m[r.key] = r.value;
    return {
      requireLocation: m.require_location_for_visit === true,
      maxAccuracyM: Number(m.visit_max_accuracy_m),
      maxDistanceM: Number(m.visit_max_distance_m),
      blockWhenFar: m.visit_block_when_far === true,
    };
  }

  async list(q: VisitsQuery, u: AuthUser) {
    let representativeId = q.representativeId;
    if (!can(u, 'visits.view_all')) {
      const rep = await this.scope.repOf(u);
      if (!rep) return new Paginated([], { page: q.page, pageSize: q.pageSize, total: 0 });
      representativeId = rep.id;
    }
    const where: Prisma.VisitWhereInput = {
      representativeId, customerId: q.customerId, visitType: q.visitType, locationStatus: q.locationStatus,
      visitDate: q.from || q.to ? { gte: q.from ? new Date(q.from.slice(0, 10)) : undefined, lte: q.to ? new Date(q.to.slice(0, 10)) : undefined } : undefined,
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.visit.findMany({ where, include: INCLUDE, orderBy: { startTime: q.order }, ...skipTake(q) }),
      this.prisma.visit.count({ where }),
    ]);
    return new Paginated(items, { page: q.page, pageSize: q.pageSize, total });
  }

  async get(id: string, u: AuthUser) {
    const v = await this.prisma.visit.findUnique({ where: { id }, include: INCLUDE });
    if (!v) throw new AppException('NOT_FOUND', 'الزيارة غير موجودة', 404);
    if (!can(u, 'visits.view_all')) {
      const rep = await this.scope.repOf(u);
      if (!rep || rep.id !== v.representativeId) throw new AppException('NOT_FOUND', 'الزيارة غير موجودة', 404);
    }
    return v;
  }

  async create(dto: CreateVisitDto, u: AuthUser, ctx: ReqCtx) {
    const myRep = await this.scope.repOf(u);
    const scoped = !can(u, 'visits.view_all'); // a field rep acts only as themselves
    let repId: string;
    if (scoped) {
      if (!myRep) throw new AppException('NOT_A_REPRESENTATIVE', 'حسابك غير مرتبط بمندوب', 403);
      if (dto.representativeId && dto.representativeId !== myRep.id) throw new AppException('FORBIDDEN', 'لا يمكنك تسجيل زيارة باسم مندوب آخر', 403);
      repId = myRep.id;
    } else {
      const id = dto.representativeId ?? myRep?.id;
      if (!id) throw new AppException('REP_REQUIRED', 'حدّد المندوب', 400);
      repId = id;
    }

    // Idempotent retry from an offline device.
    if (dto.localId) {
      if (!ctx.device) throw new AppException('DEVICE_REQUIRED', 'أرسل x-device-id مع localId', 400);
      const existing = await this.prisma.visit.findUnique({ where: { deviceId_localId: { deviceId: ctx.device, localId: dto.localId } }, include: INCLUDE });
      if (existing) return existing;
    }

    const [rep, customer, cfg] = await Promise.all([
      this.prisma.representative.findUnique({ where: { id: repId } }),
      this.prisma.customer.findUnique({ where: { id: dto.customerId } }),
      this.settings(),
    ]);
    if (!rep || rep.status !== 'Active') throw new AppException('REP_NOT_ACTIVE', 'المندوب غير فعّال', 400);
    if (!customer || customer.status === 'Inactive') throw new AppException('INVALID_CUSTOMER', 'العميل غير موجود أو غير فعّال', 400);
    if (scoped) {
      const link = await this.prisma.customerRepresentative.findFirst({ where: { customerId: customer.id, representativeId: repId, assignedTo: null } });
      if (!link) throw new AppException('CUSTOMER_NOT_ASSIGNED', 'هذا العميل غير مسند لك', 403);
    }

    const start = new Date(dto.startTime);
    const end = dto.endTime ? new Date(dto.endTime) : null;
    const now = Date.now();
    if (start.getTime() > now + MAX_FUTURE_MS) throw new AppException('INVALID_TIME', 'وقت البدء في المستقبل', 400);
    if (start.getTime() < now - MAX_AGE_MS) throw new AppException('INVALID_TIME', 'وقت البدء قديم جداً', 400);
    if (end && end < start) throw new AppException('INVALID_TIME', 'وقت الانتهاء قبل وقت البدء', 400);
    if ((dto.latitude == null) !== (dto.longitude == null)) throw new AppException('INVALID_LOCATION', 'أرسل latitude و longitude معاً', 400);

    const hasFullFix = dto.latitude != null && dto.accuracyM != null && dto.locationAt != null;
    if (cfg.requireLocation && !hasFullFix) throw new AppException('LOCATION_REQUIRED', 'تسجيل الزيارة يتطلب الموقع (الإحداثيات والدقة ووقت القراءة)', 400);

    const loc = evaluateVisitLocation({
      latitude: dto.latitude, longitude: dto.longitude, accuracyM: dto.accuracyM,
      customerLat: customer.latitude, customerLng: customer.longitude,
      maxAccuracyM: cfg.maxAccuracyM, maxDistanceM: cfg.maxDistanceM,
    });
    if (cfg.requireLocation && cfg.blockWhenFar && loc.status === 'TooFar') {
      throw new AppException('VISIT_TOO_FAR', `موقعك بعيد عن العميل (${loc.distanceM} م)`, 422, { distanceM: loc.distanceM, maxDistanceM: cfg.maxDistanceM });
    }

    const visitDate = new Date(localDate(start)); // calendar day in Baghdad time
    try {
      return await this.prisma.$transaction(async (tx) => {
        const v = await tx.visit.create({
          data: {
            representativeId: repId, customerId: customer.id, visitDate, startTime: start, endTime: end,
            latitude: dto.latitude, longitude: dto.longitude, accuracyM: dto.accuracyM, locationAt: dto.locationAt ? new Date(dto.locationAt) : null,
            distanceM: loc.distanceM, locationStatus: loc.status, visitType: dto.visitType, outcome: dto.outcome, notes: dto.notes,
            nextVisitDate: dto.nextVisitDate ? new Date(dto.nextVisitDate.slice(0, 10)) : null,
            deviceId: dto.localId ? ctx.device : null, localId: dto.localId ?? null, createdById: u.id,
          },
          include: INCLUDE,
        });
        // A visit fulfils that day's open plan entry for this customer, if any.
        await tx.visitPlan.updateMany({
          where: { representativeId: repId, customerId: customer.id, planDate: visitDate, status: 'Planned', visitId: null },
          data: { status: 'Done', visitId: v.id },
        });
        await this.audit.log({ userId: u.id, action: 'visits.create', entity: 'visit', entityId: v.id, newValues: { ...v, flagged: loc.status !== 'Verified' }, ctx }, tx);
        return v;
      });
    } catch (e) {
      // Two concurrent syncs of the same offline visit: the unique (deviceId, localId) wins; return the stored one.
      if (dto.localId && ctx.device && e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') {
        const again = await this.prisma.visit.findUnique({ where: { deviceId_localId: { deviceId: ctx.device, localId: dto.localId } }, include: INCLUDE });
        if (again) return again;
      }
      throw e;
    }
  }

  async update(id: string, dto: UpdateVisitDto, u: AuthUser, ctx: ReqCtx) {
    const before = await this.get(id, u); // enforces scope
    if (!can(u, 'visits.view_all') && Date.now() - before.createdAt.getTime() > EDIT_WINDOW_MS) {
      throw new AppException('VISIT_LOCKED', 'انتهت مهلة تعديل الزيارة (24 ساعة)', 403);
    }
    const end = dto.endTime ? new Date(dto.endTime) : undefined;
    if (end && end < before.startTime) throw new AppException('INVALID_TIME', 'وقت الانتهاء قبل وقت البدء', 400);
    return this.prisma.$transaction(async (tx) => {
      const after = await tx.visit.update({
        where: { id }, include: INCLUDE,
        data: { endTime: end, visitType: dto.visitType, outcome: dto.outcome, notes: dto.notes, nextVisitDate: dto.nextVisitDate ? new Date(dto.nextVisitDate.slice(0, 10)) : undefined },
      });
      await this.audit.log({ userId: u.id, action: 'visits.update', entity: 'visit', entityId: id, oldValues: before, newValues: after, ctx }, tx);
      return after;
    });
  }
}

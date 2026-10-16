import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { SequenceService } from '../sequence/sequence.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser, ReqCtx } from '../common/decorators';
import { buildSearchText, normalizeSearch } from '../common/arabic';
import { bboxFor, haversineMeters } from '../common/geo';
import { can } from '../common/perm';
import { skipTake } from '../common/pagination';
import { Paginated } from '../common/response';
import { AssignCustomerDto, CreateCustomerDto, CustomersQuery, MapQuery, UpdateCustomerDto } from './customers.dto';

const INCLUDE = {
  area: { select: { id: true, name: true } },
  priceList: { select: { id: true, name: true } },
  representatives: {
    where: { assignedTo: null, isPrimary: true }, take: 1,
    select: { assignedFrom: true, representative: { select: { id: true, fullName: true, employeeCode: true } } },
  },
} satisfies Prisma.CustomerInclude;
type CustomerRow = Prisma.CustomerGetPayload<{ include: typeof INCLUDE }>;

const CREDIT_FIELDS = ['creditLimit', 'openingBalance', 'priceListId', 'status'] as const;

function shape(c: CustomerRow) {
  const { searchText: _s, representatives, ...rest } = c;
  return { ...rest, assignedRepresentative: representatives[0]?.representative ?? null, assignedSince: representatives[0]?.assignedFrom ?? null };
}

@Injectable()
export class CustomersService {
  constructor(private prisma: PrismaService, private audit: AuditService, private seq: SequenceService, private scope: ScopeService) {}

  private searchText(c: { name: string; ownerName?: string | null; phone?: string | null; secondaryPhone?: string | null; licenseNumber?: string | null; city?: string | null; district?: string | null; address?: string | null }, code: string) {
    return buildSearchText(c.name, c.ownerName, c.phone, c.secondaryPhone, c.licenseNumber, c.city, c.district, c.address, code);
  }

  private async assertRefs(tx: Prisma.TransactionClient, areaId?: string | null, priceListId?: string | null) {
    if (areaId) {
      const a = await tx.area.findUnique({ where: { id: areaId } });
      if (!a || !a.isActive) throw new AppException('INVALID_AREA', 'المنطقة غير موجودة أو معطّلة', 400);
    }
    if (priceListId) {
      const p = await tx.priceList.findUnique({ where: { id: priceListId } });
      if (!p || !p.isActive) throw new AppException('INVALID_PRICE_LIST', 'قائمة الأسعار غير موجودة أو معطّلة', 400);
    }
  }

  private assertGeo(lat?: number | null, lng?: number | null) {
    if ((lat == null) !== (lng == null)) throw new AppException('INVALID_LOCATION', 'يجب إدخال خط العرض والطول معاً', 400);
  }

  async list(q: CustomersQuery, u: AuthUser) {
    const terms = q.q ? normalizeSearch(q.q).split(' ').filter(Boolean) : [];
    const scope = await this.scope.customerScope(u);
    const where: Prisma.CustomerWhereInput = {
      AND: [
        scope,
        {
          customerType: q.customerType, status: q.status, areaId: q.areaId,
          city: q.city ? { equals: q.city, mode: 'insensitive' } : undefined,
          representatives: q.representativeId ? { some: { representativeId: q.representativeId, assignedTo: null } } : undefined,
        },
        ...terms.map((t) => ({ searchText: { contains: t } })),
      ],
    };
    const sortable = ['name', 'code', 'createdAt'];
    const sort = q.sort && sortable.includes(q.sort) ? q.sort : 'name';
    const [items, total] = await this.prisma.$transaction([
      this.prisma.customer.findMany({ where, include: INCLUDE, orderBy: { [sort]: q.sort ? q.order : 'asc' }, ...skipTake(q) }),
      this.prisma.customer.count({ where }),
    ]);
    return new Paginated(items.map(shape), { page: q.page, pageSize: q.pageSize, total });
  }

  private async findScoped(id: string, u: AuthUser) {
    const c = await this.prisma.customer.findFirst({ where: { AND: [{ id }, await this.scope.customerScope(u)] }, include: INCLUDE });
    if (!c) throw new AppException('NOT_FOUND', 'العميل غير موجود', 404); // 404 (not 403) so out-of-scope ids are not revealed
    return c;
  }

  async get(id: string, u: AuthUser) {
    const c = await this.findScoped(id, u);
    const last = await this.prisma.visit.aggregate({ where: { customerId: id }, _max: { visitDate: true } });
    return { ...shape(c), lastVisitDate: last._max.visitDate };
  }

  async create(dto: CreateCustomerDto, u: AuthUser, ctx: ReqCtx) {
    this.assertGeo(dto.latitude, dto.longitude);
    const touchesCredit = dto.creditLimit !== undefined || dto.openingBalance !== undefined || dto.priceListId;
    if (touchesCredit && !can(u, 'customers.manage_credit')) throw new AppException('FORBIDDEN', 'تحديد الحد الائتماني/الرصيد الافتتاحي/قائمة الأسعار يتطلب صلاحية خاصة', 403);

    const myRep = await this.scope.repOf(u);
    const { assignedRepresentativeId, ...data } = dto;
    let repId = assignedRepresentativeId ?? null;
    if (repId && repId !== myRep?.id && !can(u, 'customers.assign')) throw new AppException('FORBIDDEN', 'إسناد العميل لمندوب آخر يتطلب صلاحية الإسناد', 403);
    if (!repId && myRep && !can(u, 'customers.view_all')) repId = myRep.id; // a field rep's new customer is theirs

    return this.prisma.$transaction(async (tx) => {
      await this.assertRefs(tx, dto.areaId, dto.priceListId);
      if (repId) {
        const rep = await tx.representative.findUnique({ where: { id: repId } });
        if (!rep || rep.status !== 'Active') throw new AppException('INVALID_REP', 'المندوب غير موجود أو غير فعّال', 400);
      }
      const code = `C-${String(await this.seq.next('customer', tx)).padStart(6, '0')}`;
      const c = await tx.customer.create({
        data: { ...data, areaId: dto.areaId ?? null, priceListId: dto.priceListId ?? null, code, searchText: this.searchText(dto, code) },
      });
      if (repId) await tx.customerRepresentative.create({ data: { customerId: c.id, representativeId: repId, isPrimary: true } });
      await this.audit.log({ userId: u.id, action: 'customers.create', entity: 'customer', entityId: c.id, newValues: { ...c, assignedRepresentativeId: repId }, ctx }, tx);
      return shape(await tx.customer.findUniqueOrThrow({ where: { id: c.id }, include: INCLUDE }));
    });
  }

  async update(id: string, dto: UpdateCustomerDto, u: AuthUser, ctx: ReqCtx) {
    await this.findScoped(id, u); // scope check
    const { assignedRepresentativeId: _ignored, ...data } = dto;
    if (CREDIT_FIELDS.some((f) => data[f] !== undefined) && !can(u, 'customers.manage_credit')) {
      throw new AppException('FORBIDDEN', 'تعديل الحد الائتماني/الرصيد الافتتاحي/الحالة/قائمة الأسعار يتطلب صلاحية خاصة', 403);
    }
    return this.prisma.$transaction(async (tx) => {
      const before = await tx.customer.findUniqueOrThrow({ where: { id } });
      const lat = data.latitude !== undefined ? data.latitude : before.latitude;
      const lng = data.longitude !== undefined ? data.longitude : before.longitude;
      this.assertGeo(lat, lng);
      await this.assertRefs(tx, data.areaId && data.areaId !== before.areaId ? data.areaId : undefined, data.priceListId && data.priceListId !== before.priceListId ? data.priceListId : undefined);
      const m = { ...before, ...data };
      const after = await tx.customer.update({ where: { id }, data: { ...data, searchText: this.searchText(m, before.code) } });
      const creditChanged = CREDIT_FIELDS.some((f) => data[f] !== undefined && data[f] !== before[f]);
      await this.audit.log({
        userId: u.id, action: data.status && data.status !== before.status ? 'customers.status_change' : creditChanged ? 'customers.credit_change' : 'customers.update',
        entity: 'customer', entityId: id, oldValues: before, newValues: after, ctx,
      }, tx);
      return shape(await tx.customer.findUniqueOrThrow({ where: { id }, include: INCLUDE }));
    });
  }

  /** Close the open primary link (history kept) and open a new one. */
  assign(id: string, dto: AssignCustomerDto, u: AuthUser, ctx: ReqCtx) {
    return this.prisma.$transaction(async (tx) => {
      const c = await tx.customer.findUnique({ where: { id } });
      if (!c) throw new AppException('NOT_FOUND', 'العميل غير موجود', 404);
      const rep = await tx.representative.findUnique({ where: { id: dto.representativeId } });
      if (!rep || rep.status !== 'Active') throw new AppException('INVALID_REP', 'المندوب غير موجود أو غير فعّال', 400);
      const open = await tx.customerRepresentative.findFirst({ where: { customerId: id, assignedTo: null, isPrimary: true } });
      if (open?.representativeId === rep.id) throw new AppException('ALREADY_ASSIGNED', 'العميل مسند لهذا المندوب مسبقاً', 400);
      const now = new Date();
      if (open) await tx.customerRepresentative.update({ where: { id: open.id }, data: { assignedTo: now } });
      await tx.customerRepresentative.create({ data: { customerId: id, representativeId: rep.id, assignedFrom: now, isPrimary: true } });
      await this.audit.log({ userId: u.id, action: 'customers.assign', entity: 'customer', entityId: id, oldValues: { representativeId: open?.representativeId ?? null }, newValues: { representativeId: rep.id }, ctx }, tx);
      return { customerId: id, representativeId: rep.id };
    });
  }

  async assignments(id: string, u: AuthUser) {
    await this.findScoped(id, u);
    return this.prisma.customerRepresentative.findMany({
      where: { customerId: id }, orderBy: { assignedFrom: 'desc' },
      select: { id: true, assignedFrom: true, assignedTo: true, isPrimary: true, representative: { select: { id: true, fullName: true } } },
    });
  }

  /** Customers with coordinates for the map; optional radius search around (lat,lng) sorted by distance. */
  async map(q: MapQuery, u: AuthUser) {
    if ((q.lat == null) !== (q.lng == null)) throw new AppException('INVALID_LOCATION', 'أرسل lat و lng معاً', 400);
    const box = q.lat != null && q.lng != null ? bboxFor(q.lat, q.lng, q.radiusM ?? 5000) : null;
    const rows = await this.prisma.customer.findMany({
      where: {
        AND: [
          await this.scope.customerScope(u),
          { latitude: { not: null }, status: q.status, areaId: q.areaId },
          box ? { latitude: { gte: box.minLat, lte: box.maxLat }, longitude: { gte: box.minLon, lte: box.maxLon } } : {},
        ],
      },
      select: { id: true, code: true, name: true, customerType: true, status: true, latitude: true, longitude: true, address: true },
      take: 2000,
    });
    if (q.lat == null || q.lng == null) return rows.map((r) => ({ ...r, distanceM: null as number | null }));
    const radius = q.radiusM ?? 5000;
    return rows
      .map((r) => ({ ...r, distanceM: Math.round(haversineMeters(q.lat!, q.lng!, r.latitude!, r.longitude!)) as number | null }))
      .filter((r) => (r.distanceM as number) <= radius)
      .sort((a, b) => (a.distanceM as number) - (b.distanceM as number));
  }
}

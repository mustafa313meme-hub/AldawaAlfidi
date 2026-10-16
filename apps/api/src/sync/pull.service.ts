import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser } from '../common/decorators';
import { can, localDate } from '../common/perm';
import { shapeProduct } from '../products/products.service';
import { CURSOR_OVERLAP_MS, decodeCursor, deltaStart, encodeCursor, pageOf } from './sync-logic';
import { PullEntity, PullQuery } from './sync.dto';

export interface PullPage {
  entity: PullEntity;
  serverTime: string;
  items: unknown[];
  nextCursor: string | null;
}

/** Settings a device needs offline. */
const DEVICE_SETTINGS = ['require_location_for_visit', 'visit_max_accuracy_m', 'visit_max_distance_m', 'currency', 'overdue_days', 'bonus_return_policy'];

@Injectable()
export class PullService {
  constructor(private prisma: PrismaService, private scope: ScopeService) {}

  /**
   * Delta download, one entity at a time, keyset-paginated on (updatedAt, id).
   * Client loop: call with `since` (previous sync's serverTime, omitted the first time) and follow `nextCursor`
   * until it is null; send the SAME `since` on every page; store the serverTime of the FIRST page as the next `since`.
   * Rows are upserted by id, so the 60-second overlap and any repeats are harmless.
   */
  async pull(entity: PullEntity, q: PullQuery, u: AuthUser): Promise<PullPage> {
    const serverTime = new Date().toISOString();
    const limit = q.limit ?? 500;
    let since: Date | undefined;
    let cur: { t: Date; id: string } | undefined;
    try {
      since = deltaStart(q.since);
      cur = q.cursor ? decodeCursor(q.cursor) : undefined;
    } catch {
      throw new AppException('INVALID_CURSOR', 'since أو cursor غير صالح', 400);
    }
    const ks = () => (cur ? { OR: [{ updatedAt: { gt: cur.t } }, { updatedAt: cur.t, id: { gt: cur.id } }] } : since ? { updatedAt: { gte: since } } : {});
    const order = [{ updatedAt: 'asc' as const }, { id: 'asc' as const }];
    const out = (items: unknown[], nextCursor: string | null = null): PullPage => ({ entity, serverTime, items, nextCursor });

    switch (entity) {
      case 'customers': {
        const rows = await this.prisma.customer.findMany({
          where: { AND: [await this.scope.customerScope(u), ks()] }, orderBy: order, take: limit + 1,
          select: { id: true, code: true, name: true, customerType: true, phone: true, secondaryPhone: true, address: true, city: true, district: true, areaId: true, latitude: true, longitude: true, ownerName: true, licenseNumber: true, creditLimit: true, paymentTerms: true, priceListId: true, status: true, notes: true, updatedAt: true },
        });
        const p = pageOf(rows, limit);
        return out(p.items, p.nextCursor);
      }
      case 'products': {
        const rows = await this.prisma.product.findMany({ where: ks(), orderBy: order, take: limit + 1 });
        const p = pageOf(rows, limit);
        return out(p.items.map((r) => shapeProduct(r, u)), p.nextCursor);
      }
      case 'categories': return this.simple(this.prisma.category.findMany({ where: ks(), orderBy: order, take: limit + 1 }), limit, out);
      case 'companies': return this.simple(this.prisma.company.findMany({ where: ks(), orderBy: order, take: limit + 1, select: { id: true, name: true, isActive: true, updatedAt: true } }), limit, out);
      case 'areas': return this.simple(this.prisma.area.findMany({ where: ks(), orderBy: order, take: limit + 1 }), limit, out);
      case 'bonusRules': return this.simple(this.prisma.bonusRule.findMany({ where: ks(), orderBy: order, take: limit + 1 }), limit, out);

      case 'visitPlans': {
        const rep = await this.scope.repOf(u);
        if (!rep) return out([]);
        const today = new Date(localDate(new Date()));
        const day = 86_400_000;
        const rows = await this.prisma.visitPlan.findMany({
          where: { AND: [{ representativeId: rep.id, planDate: { gte: new Date(today.getTime() - day), lte: new Date(today.getTime() + 14 * day) } }, ks()] },
          orderBy: order, take: limit + 1,
          select: { id: true, planDate: true, customerId: true, priority: true, plannedOrder: true, status: true, visitId: true, updatedAt: true },
        });
        const p = pageOf(rows, limit);
        return out(p.items, p.nextCursor);
      }

      case 'openInvoices': {
        const rows = await this.prisma.invoice.findMany({
          // a first sync sends only what is still owed; a delta also sends invoices that just got settled so the device can close them
          where: { AND: [{ customer: await this.scope.customerScope(u) }, since || cur ? {} : { status: 'Confirmed', remainingAmount: { gt: 0 } }, ks()] },
          orderBy: order, take: limit + 1,
          select: { id: true, invoiceNumber: true, customerId: true, invoiceDate: true, netTotal: true, paidAmount: true, returnedAmount: true, remainingAmount: true, paymentStatus: true, status: true, updatedAt: true },
        });
        const p = pageOf(rows, limit);
        return out(p.items, p.nextCursor);
      }

      case 'removedCustomers': {
        // customers that stopped being this representative's: the device must delete them locally
        const rep = await this.scope.repOf(u);
        if (!rep || !since) return out([]);
        const ended = await this.prisma.customerRepresentative.findMany({ where: { representativeId: rep.id, assignedTo: { gte: since } }, select: { customerId: true }, distinct: ['customerId'] });
        const still = await this.prisma.customerRepresentative.findMany({ where: { representativeId: rep.id, assignedTo: null, customerId: { in: ended.map((e) => e.customerId) } }, select: { customerId: true } });
        const keep = new Set(still.map((s) => s.customerId));
        return out(ended.map((e) => e.customerId).filter((id) => !keep.has(id)));
      }

      case 'settings': {
        const rows = await this.prisma.setting.findMany({ where: { key: { in: DEVICE_SETTINGS } } });
        return out(rows.map((r) => ({ key: r.key, value: r.value })));
      }

      case 'priceLists': {
        // always the whole (small) set the device may use, with item counts, so it can detect missing/removed items
        const used = await this.relevantListIds(u);
        if (!used.length || !can(u, 'products.view_prices')) return out([]);
        const lists = await this.prisma.priceList.findMany({ where: { id: { in: used } }, include: { _count: { select: { items: true } } } });
        return out(lists.map((l) => ({ id: l.id, name: l.name, isDefault: l.isDefault, isActive: l.isActive, itemCount: l._count.items, updatedAt: l.updatedAt })));
      }

      case 'priceListItems': {
        if (!can(u, 'products.view_prices')) return out([]);
        const used = await this.relevantListIds(u);
        if (!used.length) return out([]);
        const [pl, pp] = cur ? cur.id.split(':') : [undefined, undefined];
        const where: Prisma.PriceListItemWhereInput = {
          priceListId: { in: used },
          ...(cur ? { OR: [{ updatedAt: { gt: cur.t } }, { updatedAt: cur.t, priceListId: { gt: pl } }, { updatedAt: cur.t, priceListId: pl, productId: { gt: pp } }] } : since ? { updatedAt: { gte: since } } : {}),
        };
        const rows = await this.prisma.priceListItem.findMany({ where, orderBy: [{ updatedAt: 'asc' }, { priceListId: 'asc' }, { productId: 'asc' }], take: limit + 1 });
        const items = rows.slice(0, limit);
        const last = items[items.length - 1];
        return out(items.map((r) => ({ priceListId: r.priceListId, productId: r.productId, price: r.price, updatedAt: r.updatedAt })), rows.length > limit && last ? encodeCursor(last.updatedAt, `${last.priceListId}:${last.productId}`) : null);
      }

      case 'balances': {
        // customer balances change with ledger entries, not with the customer row, so they are their own entity
        const ids = (await this.prisma.customer.findMany({ where: await this.scope.customerScope(u), select: { id: true } })).map((c) => c.id);
        if (!ids.length) return out([]);
        const stamp = Prisma.sql`GREATEST(c."updatedAt", COALESCE(l.last, c."updatedAt"))`;
        const cond = cur ? Prisma.sql`AND (${stamp}, c.id) > (${cur.t}, ${cur.id})` : since ? Prisma.sql`AND ${stamp} >= ${since}` : Prisma.empty;
        const rows = await this.prisma.$queryRaw<{ id: string; balance: bigint; updatedAt: Date }[]>`
          SELECT c.id, (c."openingBalance" + COALESCE(l.net, 0))::bigint AS balance, ${stamp} AS "updatedAt"
          FROM customers c LEFT JOIN (SELECT "customerId", SUM(debit) - SUM(credit) AS net, MAX("createdAt") AS last FROM ledger_entries GROUP BY 1) l ON l."customerId" = c.id
          WHERE c.id = ANY(${ids}) ${cond} ORDER BY "updatedAt" ASC, c.id ASC LIMIT ${limit + 1}`;
        const p = pageOf(rows, limit);
        return out(p.items.map((r) => ({ customerId: r.id, balance: Number(r.balance), updatedAt: r.updatedAt })), p.nextCursor);
      }
    }
  }

  private async simple<T extends { id: string; updatedAt: Date }>(query: Promise<T[]>, limit: number, out: (i: unknown[], c?: string | null) => PullPage): Promise<PullPage> {
    const p = pageOf(await query, limit);
    return out(p.items, p.nextCursor);
  }

  /** Price lists this user's customers use, plus the default list. */
  private async relevantListIds(u: AuthUser): Promise<string[]> {
    const [custLists, def] = await Promise.all([
      this.prisma.customer.findMany({ where: { AND: [await this.scope.customerScope(u), { priceListId: { not: null } }] }, select: { priceListId: true }, distinct: ['priceListId'] }),
      this.prisma.priceList.findFirst({ where: { isDefault: true, isActive: true }, select: { id: true } }),
    ]);
    return [...new Set([...custLists.map((c) => c.priceListId as string), ...(def ? [def.id] : [])])];
  }

  manifest(u: AuthUser, repId: string | null) {
    return {
      serverTime: new Date().toISOString(),
      user: { id: u.id, username: u.username, fullName: u.fullName, role: u.roleName, representativeId: repId },
      limits: { pushMaxOperations: 100, pullMaxLimit: 1000, pullOverlapSeconds: CURSOR_OVERLAP_MS / 1000 },
      pushTypes: ['visit', 'order', 'payment', 'return'],
      pullEntities: ['customers', 'removedCustomers', 'balances', 'products', 'categories', 'companies', 'areas', 'bonusRules', 'priceLists', 'priceListItems', 'visitPlans', 'openInvoices', 'settings'],
    };
  }
}

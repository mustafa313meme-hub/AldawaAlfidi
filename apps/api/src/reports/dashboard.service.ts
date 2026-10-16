import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { ScopeService } from '../common/scope.service';
import { AppException } from '../common/app.exception';
import { AuthUser } from '../common/decorators';
import { DEFAULT_SETTINGS } from '../common/permissions.constants';
import { dayEnd, dayStart, localDate } from '../common/perm';
import { dailyTarget, percent } from './reports-logic';
import { localDay, plain } from './reports.service';
import { DashboardQuery } from './reports.dto';

@Injectable()
export class DashboardService {
  constructor(private prisma: PrismaService, private scope: ScopeService) {}

  private bounds() {
    const today = localDate(new Date());
    return { today, todayStart: dayStart(today), monthStart: dayStart(today.slice(0, 8) + '01'), todayDate: new Date(today), in30: new Date(new Date(today).getTime() + 30 * 86_400_000) };
  }

  /** Management dashboard (SRS §37, §101). Every figure is a live query; there is no cache to go stale. */
  async admin(q: DashboardQuery) {
    const b = this.bounds();
    const rep = q.representativeId;
    const inv = (from: Date): Prisma.InvoiceWhereInput => ({ status: 'Confirmed', invoiceDate: { gte: from }, representativeId: rep });
    const pay = (from: Date): Prisma.PaymentWhereInput => ({ status: 'Confirmed', paymentDate: { gte: from }, representativeId: rep });
    const ret = (from: Date): Prisma.ReturnWhereInput => ({ returnDate: { gte: from }, invoice: rep ? { representativeId: rep } : undefined });
    const repSql = rep ? Prisma.sql`AND i."representativeId" = ${rep}` : Prisma.empty;
    const monthFrom = b.monthStart;

    const [salesToday, salesMonth, collToday, collMonth, retToday, retMonth, ordersToday, pendingOrders, activeReps, visitsToday, receivables, lowStock, nearExpiry, expired, topCustomers, topProducts, topReps] = await Promise.all([
      this.prisma.invoice.aggregate({ where: inv(b.todayStart), _sum: { netTotal: true, discountTotal: true }, _count: true }),
      this.prisma.invoice.aggregate({ where: inv(monthFrom), _sum: { netTotal: true, discountTotal: true }, _count: true }),
      this.prisma.payment.aggregate({ where: pay(b.todayStart), _sum: { amount: true }, _count: true }),
      this.prisma.payment.aggregate({ where: pay(monthFrom), _sum: { amount: true }, _count: true }),
      this.prisma.return.aggregate({ where: ret(b.todayStart), _sum: { creditAmount: true, billedAmount: true }, _count: true }),
      this.prisma.return.aggregate({ where: ret(monthFrom), _sum: { creditAmount: true, billedAmount: true }, _count: true }),
      this.prisma.salesOrder.count({ where: { orderDate: { gte: b.todayStart }, status: { not: 'Cancelled' }, representativeId: rep } }),
      this.prisma.salesOrder.count({ where: { status: 'Submitted', representativeId: rep } }),
      this.prisma.representative.count({ where: { status: 'Active' } }),
      this.prisma.visit.count({ where: { visitDate: b.todayDate, representativeId: rep } }),
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT COALESCE(SUM(CASE WHEN bal > 0 THEN bal ELSE 0 END),0)::bigint AS total, COUNT(*) FILTER (WHERE bal > 0)::int AS debtors
        FROM (SELECT c."openingBalance" + COALESCE(l.net, 0) AS bal FROM customers c
              LEFT JOIN (SELECT "customerId", SUM(debit) - SUM(credit) AS net FROM ledger_entries GROUP BY 1) l ON l."customerId" = c.id) t`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT COUNT(*)::int AS products FROM (
          SELECT p.id FROM products p LEFT JOIN stock s ON s."productId" = p.id
          WHERE p."isActive" AND p."reorderLevel" > 0 GROUP BY p.id, p."reorderLevel" HAVING COALESCE(SUM(s.quantity), 0) < p."reorderLevel") t`,
      this.prisma.stockBatch.aggregate({ where: { quantity: { gt: 0 }, expiryDate: { gte: b.todayDate, lte: b.in30 } }, _sum: { quantity: true }, _count: true }),
      this.prisma.stockBatch.aggregate({ where: { quantity: { gt: 0 }, expiryDate: { lt: b.todayDate } }, _sum: { quantity: true }, _count: true }),
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT c.code, c.name, SUM(i."netTotal")::bigint AS net FROM invoices i JOIN customers c ON c.id = i."customerId"
        WHERE i.status = 'Confirmed' AND i."invoiceDate" >= ${monthFrom} ${repSql} GROUP BY c.id, c.code, c.name ORDER BY net DESC LIMIT 5`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT p.sku AS code, p."nameAr" AS name, SUM(ii.quantity)::bigint AS quantity, SUM(ii."lineTotal")::bigint AS net
        FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId" JOIN products p ON p.id = ii."productId"
        WHERE i.status = 'Confirmed' AND i."invoiceDate" >= ${monthFrom} ${repSql} GROUP BY p.id, p.sku, p."nameAr" ORDER BY net DESC LIMIT 5`,
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT rep."employeeCode" AS code, rep."fullName" AS name, SUM(i."netTotal")::bigint AS net, COUNT(*)::int AS invoices
        FROM invoices i JOIN representatives rep ON rep.id = i."representativeId"
        WHERE i.status = 'Confirmed' AND i."invoiceDate" >= ${monthFrom} ${repSql} GROUP BY rep.id, rep."employeeCode", rep."fullName" ORDER BY net DESC LIMIT 10`,
    ]);

    const net = (r: { _sum: { creditAmount: number | null; billedAmount: number | null } }) => (r._sum.creditAmount ?? 0) - (r._sum.billedAmount ?? 0);
    return {
      asOf: new Date().toISOString(), today: b.today,
      sales: {
        today: { invoices: salesToday._count, amount: salesToday._sum.netTotal ?? 0, discount: salesToday._sum.discountTotal ?? 0 },
        month: { invoices: salesMonth._count, amount: salesMonth._sum.netTotal ?? 0, discount: salesMonth._sum.discountTotal ?? 0 },
      },
      returns: { today: { count: retToday._count, amount: net(retToday) }, month: { count: retMonth._count, amount: net(retMonth) } },
      netSales: { today: (salesToday._sum.netTotal ?? 0) - net(retToday), month: (salesMonth._sum.netTotal ?? 0) - net(retMonth) },
      collections: { today: { count: collToday._count, amount: collToday._sum.amount ?? 0 }, month: { count: collMonth._count, amount: collMonth._sum.amount ?? 0 } },
      orders: { today: ordersToday, pendingApproval: pendingOrders },
      receivables: { total: Number(plain(receivables)[0].total), debtors: Number(plain(receivables)[0].debtors) },
      representatives: { active: activeReps, visitsToday },
      inventory: {
        lowStockProducts: Number(plain(lowStock)[0].products),
        nearExpiry30d: { batches: nearExpiry._count, units: nearExpiry._sum.quantity ?? 0 },
        expired: { batches: expired._count, units: expired._sum.quantity ?? 0 },
      },
      topCustomers: plain(topCustomers), topProducts: plain(topProducts), topRepresentatives: plain(topReps),
    };
  }

  /** The representative's own dashboard (SRS §38): own numbers only, derived from the account's linked representative. */
  async mine(u: AuthUser) {
    const rep = await this.scope.repOf(u);
    if (!rep) throw new AppException('NOT_A_REPRESENTATIVE', 'حسابك غير مرتبط بمندوب', 403);
    const b = this.bounds();
    const overdueRow = await this.prisma.setting.findUnique({ where: { key: 'overdue_days' } });
    const overdueDays = Number(overdueRow?.value ?? DEFAULT_SETTINGS.overdue_days);

    const [salesToday, salesMonth, collToday, visitsToday, ordersToday, plan, targets, overdue] = await Promise.all([
      this.prisma.invoice.aggregate({ where: { representativeId: rep.id, status: 'Confirmed', invoiceDate: { gte: b.todayStart } }, _sum: { netTotal: true }, _count: true }),
      this.prisma.invoice.aggregate({ where: { representativeId: rep.id, status: 'Confirmed', invoiceDate: { gte: b.monthStart } }, _sum: { netTotal: true, returnedAmount: true }, _count: true }),
      this.prisma.payment.aggregate({ where: { representativeId: rep.id, status: 'Confirmed', paymentDate: { gte: b.todayStart } }, _sum: { amount: true }, _count: true }),
      this.prisma.visit.count({ where: { representativeId: rep.id, visitDate: b.todayDate } }),
      this.prisma.salesOrder.count({ where: { representativeId: rep.id, orderDate: { gte: b.todayStart }, status: { not: 'Cancelled' } } }),
      this.prisma.visitPlan.groupBy({ by: ['status'], where: { representativeId: rep.id, planDate: b.todayDate }, _count: true }),
      this.prisma.salesTarget.findMany({ where: { representativeId: rep.id, startDate: { lte: b.todayDate }, endDate: { gte: b.todayDate } }, orderBy: { startDate: 'desc' } }),
      this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT c.id, c.code, c.name, SUM(i."remainingAmount")::bigint AS overdue,
               MAX(GREATEST(0, (${b.today}::date - ${localDay('i."invoiceDate"')})))::int AS "oldestAgeDays"
        FROM invoices i JOIN customers c ON c.id = i."customerId"
        JOIN customer_representatives cr ON cr."customerId" = c.id AND cr."assignedTo" IS NULL AND cr."isPrimary" AND cr."representativeId" = ${rep.id}
        WHERE i.status = 'Confirmed' AND i."remainingAmount" > 0 AND (${b.today}::date - ${localDay('i."invoiceDate"')}) > ${overdueDays}
        GROUP BY c.id, c.code, c.name ORDER BY overdue DESC LIMIT 10`,
    ]);

    // the monthly target (if any) drives "today's target"; otherwise the most recent covering target
    const t = targets.find((x) => x.periodType === 'Monthly') ?? targets[0];
    let target: Record<string, unknown> | null = null;
    if (t) {
      const s = t.startDate.toISOString().slice(0, 10);
      const e = t.endDate.toISOString().slice(0, 10);
      const toDate = await this.prisma.invoice.aggregate({ where: { representativeId: rep.id, status: 'Confirmed', invoiceDate: { gte: dayStart(s), lte: dayEnd(b.today) } }, _sum: { netTotal: true, returnedAmount: true } });
      const achieved = (toDate._sum.netTotal ?? 0) - (toDate._sum.returnedAmount ?? 0);
      const daily = dailyTarget(t.targetAmount, s, e);
      target = {
        periodType: t.periodType, startDate: s, endDate: e, targetAmount: t.targetAmount, achievedAmount: achieved, achievementPct: percent(achieved, t.targetAmount),
        dailyTarget: daily, todayPct: percent(salesToday._sum.netTotal ?? 0, daily),
      };
    }
    const planCounts = Object.fromEntries(['Planned', 'Done', 'Skipped', 'Cancelled'].map((s) => [s, plan.find((p) => p.status === s)?._count ?? 0]));
    return {
      representative: { id: rep.id, code: rep.employeeCode, name: rep.fullName }, today: b.today,
      sales: { today: { invoices: salesToday._count, amount: salesToday._sum.netTotal ?? 0 }, month: { invoices: salesMonth._count, amount: (salesMonth._sum.netTotal ?? 0) - (salesMonth._sum.returnedAmount ?? 0) } },
      collections: { today: { count: collToday._count, amount: collToday._sum.amount ?? 0 } },
      visits: { today: visitsToday, plan: planCounts }, orders: { today: ordersToday }, target,
      overdueCustomers: plain(overdue), overdueDays,
    };
  }
}

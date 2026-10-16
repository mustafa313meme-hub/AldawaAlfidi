import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { SUPER_ADMIN_ROLE } from '../common/permissions.constants';
import { dayStart, localDate } from '../common/perm';
import { localDay } from '../reports/reports.service';
import { DEFAULT_SETTINGS } from '../common/permissions.constants';
import { PushSender } from './push.sender';

export interface NewNotification {
  type: string;
  title: string;
  body: string;
  data?: Record<string, unknown>;
  /** With the same key a user gets the notification at most once (e.g. "expiry:2026-10-10"). */
  dedupeKey?: string;
}

const fmt = (n: number) => n.toLocaleString('en-US');

@Injectable()
export class NotificationsService {
  private readonly logger = new Logger('Notifications');

  constructor(private prisma: PrismaService, private push: PushSender) {}

  /** Never throws: a failed notification must not fail the business operation that triggered it. */
  async notifyUsers(userIds: string[], n: NewNotification): Promise<number> {
    let created = 0;
    const fresh: string[] = [];
    try {
      for (const userId of new Set(userIds)) {
        try {
          await this.prisma.notification.create({ data: { userId, type: n.type, title: n.title, body: n.body, data: (n.data ?? undefined) as Prisma.InputJsonValue | undefined, dedupeKey: n.dedupeKey } });
          created++;
          fresh.push(userId);
        } catch (e) {
          if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002')) throw e; // already sent (dedupe): fine
        }
      }
      if (fresh.length) await this.push.send(fresh, n);
    } catch (e) {
      this.logger.error(`notify failed: ${e instanceof Error ? e.message : String(e)}`);
    }
    return created;
  }

  /** Active users who hold `code` through their role or a personal grant, minus personal denials; Super Admins always. */
  async usersWithPermission(code: string): Promise<string[]> {
    const users = await this.prisma.user.findMany({
      where: {
        isActive: true, deletedAt: null,
        OR: [{ role: { name: SUPER_ADMIN_ROLE } }, { role: { permissions: { some: { permission: { code } } } } }, { permissions: { some: { allowed: true, permission: { code } } } }],
      },
      select: { id: true, role: { select: { name: true } }, permissions: { where: { allowed: false, permission: { code } }, select: { allowed: true } } },
    });
    return users.filter((u) => u.role.name === SUPER_ADMIN_ROLE || u.permissions.length === 0).map((u) => u.id);
  }

  async notifyPermission(code: string, n: NewNotification): Promise<number> {
    try {
      return await this.notifyUsers(await this.usersWithPermission(code), n);
    } catch (e) {
      this.logger.error(`notifyPermission failed: ${e instanceof Error ? e.message : String(e)}`);
      return 0;
    }
  }

  /**
   * Scheduled checks (SRS: expiry alerts, overdue customers, low stock). Idempotent per day thanks to dedupe keys,
   * so running it every few hours, or from several instances, never produces duplicates.
   */
  async runChecks() {
    const today = localDate(new Date());
    const todayDate = new Date(today);
    const in30 = new Date(todayDate.getTime() + 30 * 86_400_000);
    const summary = { expiry: 0, lowStock: 0, overdue: 0 };

    const [near, expired, low] = await Promise.all([
      this.prisma.stockBatch.aggregate({ where: { quantity: { gt: 0 }, expiryDate: { gte: todayDate, lte: in30 } }, _sum: { quantity: true }, _count: true }),
      this.prisma.stockBatch.aggregate({ where: { quantity: { gt: 0 }, expiryDate: { lt: todayDate } }, _sum: { quantity: true }, _count: true }),
      this.prisma.$queryRaw<{ n: number }[]>`
        SELECT COUNT(*)::int AS n FROM (
          SELECT p.id FROM products p LEFT JOIN stock s ON s."productId" = p.id
          WHERE p."isActive" AND p."reorderLevel" > 0 GROUP BY p.id, p."reorderLevel" HAVING COALESCE(SUM(s.quantity), 0) < p."reorderLevel") t`,
    ]);

    if (near._count > 0 || expired._count > 0) {
      summary.expiry = await this.notifyPermission('reports.inventory', {
        type: 'expiry', title: 'تنبيه صلاحية الأدوية',
        body: `منتهية: ${fmt(expired._sum.quantity ?? 0)} وحدة (${expired._count} تشغيلة) — تنتهي خلال 30 يوماً: ${fmt(near._sum.quantity ?? 0)} وحدة (${near._count} تشغيلة)`,
        data: { expiredBatches: expired._count, nearBatches: near._count }, dedupeKey: `expiry:${today}`,
      });
    }
    if (low[0]?.n > 0) {
      summary.lowStock = await this.notifyPermission('reports.inventory', {
        type: 'low_stock', title: 'مخزون منخفض', body: `${low[0].n} منتج دون حد إعادة الطلب`, data: { products: low[0].n }, dedupeKey: `lowstock:${today}`,
      });
    }

    const row = await this.prisma.setting.findUnique({ where: { key: 'overdue_days' } });
    const overdueDays = Number(row?.value ?? DEFAULT_SETTINGS.overdue_days);
    const overdue = await this.prisma.$queryRaw<{ userId: string; customers: number; amount: bigint }[]>`
      SELECT rep."userId" AS "userId", COUNT(DISTINCT c.id)::int AS customers, SUM(i."remainingAmount")::bigint AS amount
      FROM invoices i JOIN customers c ON c.id = i."customerId"
      JOIN customer_representatives cr ON cr."customerId" = c.id AND cr."assignedTo" IS NULL AND cr."isPrimary"
      JOIN representatives rep ON rep.id = cr."representativeId" AND rep."userId" IS NOT NULL AND rep.status = 'Active'
      WHERE i.status = 'Confirmed' AND i."remainingAmount" > 0 AND (${today}::date - ${localDay('i."invoiceDate"')}) > ${overdueDays}
      GROUP BY rep."userId"`;
    for (const o of overdue) {
      summary.overdue += await this.notifyUsers([o.userId], {
        type: 'overdue', title: 'عملاء متأخرون في السداد', body: `${o.customers} عميل — ${fmt(Number(o.amount))} دينار متأخرة أكثر من ${overdueDays} يوماً`,
        data: { customers: o.customers, amount: Number(o.amount), overdueDays }, dedupeKey: `overdue:${today}`,
      });
    }
    return { date: today, created: summary, startOfDay: dayStart(today).toISOString() };
  }

  // ───────── inbox ─────────
  list(userId: string, unreadOnly: boolean, page: number, pageSize: number) {
    const where: Prisma.NotificationWhereInput = { userId, readAt: unreadOnly ? null : undefined };
    return this.prisma.$transaction([
      this.prisma.notification.findMany({ where, orderBy: { createdAt: 'desc' }, skip: (page - 1) * pageSize, take: pageSize }),
      this.prisma.notification.count({ where }),
    ]);
  }

  unreadCount(userId: string) {
    return this.prisma.notification.count({ where: { userId, readAt: null } });
  }

  async markRead(userId: string, id: string): Promise<boolean> {
    const r = await this.prisma.notification.updateMany({ where: { id, userId, readAt: null }, data: { readAt: new Date() } });
    return r.count === 1;
  }

  async markAllRead(userId: string): Promise<number> {
    return (await this.prisma.notification.updateMany({ where: { userId, readAt: null }, data: { readAt: new Date() } })).count;
  }
}

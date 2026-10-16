import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { AppException } from '../common/app.exception';
import { AuthUser } from '../common/decorators';
import { can, dayEnd, dayStart, localDate } from '../common/perm';
import { Column, daysInclusive, percent } from './reports-logic';
import { AgingQuery, InventoryCurrentQuery, MoversQuery, PagedReportFilters, ReportFilters, ReturnsDim, SalesDim, TargetQuery } from './reports.dto';

export interface ReportResult {
  title: string;
  columns: Column[];
  rows: Record<string, unknown>[];
  totals?: Record<string, number>;
  meta?: Record<string, unknown>;
}

const MAX_RANGE_DAYS = 1100;
const CSV_CAP = 50_000;

// Timestamps are stored as UTC in "timestamp" columns; calendar days/months are Baghdad days.
const local = (col: string) => `((${col}) AT TIME ZONE 'UTC') AT TIME ZONE 'Asia/Baghdad'`;
export const localDay = (col: string) => Prisma.raw(`(${local(col)})::date`);
const localMonth = (col: string) => Prisma.raw(`date_trunc('month', ${local(col)})::date`);
const SIGNED = Prisma.raw(`CASE WHEN m."movementType" IN ('Purchase','ReturnIn','TransferIn','AdjustmentIn','OpeningBalance') THEN m.quantity ELSE -m.quantity END`);

/** bigint / Decimal -> number so rows serialise as JSON; dates stay Dates. */
export function plain<T>(rows: T[]): Record<string, unknown>[] {
  return rows.map((r) => Object.fromEntries(Object.entries(r as Record<string, unknown>).map(([k, v]) => [k, typeof v === 'bigint' ? Number(v) : v && typeof v === 'object' && 'toNumber' in (v as object) ? (v as { toNumber(): number }).toNumber() : v])));
}
const sum = (rows: Record<string, unknown>[], key: string) => rows.reduce((s, r) => s + Number(r[key] ?? 0), 0);

@Injectable()
export class ReportsService {
  constructor(private prisma: PrismaService) {}

  // ───────── helpers ─────────

  private range(f: { from?: string; to?: string }) {
    if (f.from && f.to) {
      if (f.from > f.to) throw new AppException('INVALID_RANGE', 'تاريخ البداية بعد النهاية', 400);
      if (daysInclusive(f.from, f.to) > MAX_RANGE_DAYS) throw new AppException('RANGE_TOO_LARGE', `الحد الأقصى ${MAX_RANGE_DAYS} يوماً`, 400);
    }
    return { from: f.from ? dayStart(f.from) : undefined, to: f.to ? dayEnd(f.to) : undefined };
  }

  private where(conds: Prisma.Sql[]) {
    return conds.length ? Prisma.sql`WHERE ${Prisma.join(conds, ' AND ')}` : Prisma.empty;
  }

  /** Common invoice-level filters. Aliases: i = invoices, c = customers. `dateCol` is a trusted constant. */
  private invConds(f: ReportFilters, dateCol: string, opts: { status?: boolean } = {}): Prisma.Sql[] {
    const r = this.range(f);
    const c: Prisma.Sql[] = [];
    if (opts.status !== false) c.push(Prisma.sql`i.status = 'Confirmed'`);
    if (r.from) c.push(Prisma.sql`${Prisma.raw(dateCol)} >= ${r.from}`);
    if (r.to) c.push(Prisma.sql`${Prisma.raw(dateCol)} <= ${r.to}`);
    if (f.representativeId) c.push(Prisma.sql`i."representativeId" = ${f.representativeId}`);
    if (f.customerId) c.push(Prisma.sql`i."customerId" = ${f.customerId}`);
    if (f.warehouseId) c.push(Prisma.sql`i."warehouseId" = ${f.warehouseId}`);
    if (f.areaId) c.push(Prisma.sql`c."areaId" = ${f.areaId}`);
    return c;
  }

  private noProductFilters(f: ReportFilters, what: string) {
    if (f.productId || f.companyId) throw new AppException('FILTER_NOT_SUPPORTED', `فلتر المنتج/الشركة غير مدعوم في ${what}؛ استخدم تقرير المبيعات حسب المنتج أو الشركة`, 400);
  }

  private limit(f: ReportFilters) {
    return f.format === 'csv' ? CSV_CAP : f.limit ?? 1000;
  }

  // ───────── sales ─────────

  /** Invoiced sales per day or month, with returns shown by RETURN date (so both views are visible). */
  async salesByPeriod(f: ReportFilters, g: 'day' | 'month'): Promise<ReportResult> {
    this.noProductFilters(f, 'تقرير المبيعات حسب الفترة');
    const bucket = g === 'month' ? localMonth : localDay;
    const sales = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${bucket('i."invoiceDate"')} AS period, COUNT(*)::int AS invoices, COALESCE(SUM(i.subtotal),0)::bigint AS gross,
             COALESCE(SUM(i."discountTotal"),0)::bigint AS discount, COALESCE(SUM(i."taxTotal"),0)::bigint AS tax,
             COALESCE(SUM(i."netTotal"),0)::bigint AS net, COALESCE(SUM(i."bonusValue"),0)::bigint AS "bonusValue"
      FROM invoices i JOIN customers c ON c.id = i."customerId" ${this.where(this.invConds(f, 'i."invoiceDate"'))}
      GROUP BY 1 ORDER BY 1`);
    const rets = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${bucket('r."returnDate"')} AS period, COUNT(*)::int AS returns, COALESCE(SUM(r."creditAmount"),0)::bigint AS credit, COALESCE(SUM(r."billedAmount"),0)::bigint AS billed
      FROM returns r JOIN invoices i ON i.id = r."invoiceId" JOIN customers c ON c.id = i."customerId" ${this.where(this.invConds(f, 'r."returnDate"', { status: false }))}
      GROUP BY 1 ORDER BY 1`);
    const key = (d: unknown) => (d instanceof Date ? d.toISOString().slice(0, 10) : String(d));
    const byPeriod = new Map<string, Record<string, unknown>>();
    for (const s of sales) byPeriod.set(key(s.period), { period: key(s.period), invoices: s.invoices, gross: s.gross, discount: s.discount, tax: s.tax, net: s.net, bonusValue: s.bonusValue, returns: 0, returnsAmount: 0 });
    for (const r of rets) {
      const row = byPeriod.get(key(r.period)) ?? { period: key(r.period), invoices: 0, gross: 0, discount: 0, tax: 0, net: 0, bonusValue: 0, returns: 0, returnsAmount: 0 };
      row.returns = r.returns;
      row.returnsAmount = Number(r.credit) - Number(r.billed); // net credit given back
      byPeriod.set(key(r.period), row);
    }
    const rows = [...byPeriod.values()].sort((a, b) => String(a.period).localeCompare(String(b.period))).map((r) => ({ ...r, netAfterReturns: Number(r.net) - Number(r.returnsAmount) }));
    return {
      title: g === 'month' ? 'المبيعات الشهرية' : 'المبيعات اليومية',
      columns: [
        { key: 'period', header: g === 'month' ? 'الشهر' : 'اليوم' }, { key: 'invoices', header: 'عدد الفواتير' }, { key: 'gross', header: 'الإجمالي قبل الخصم' },
        { key: 'discount', header: 'الخصم' }, { key: 'tax', header: 'الضريبة' }, { key: 'net', header: 'صافي الفواتير' }, { key: 'bonusValue', header: 'قيمة البونص (غير مفوتر)' },
        { key: 'returns', header: 'عدد المردودات' }, { key: 'returnsAmount', header: 'قيمة المردودات' }, { key: 'netAfterReturns', header: 'الصافي بعد المردودات' },
      ],
      rows,
      totals: { invoices: sum(rows, 'invoices'), gross: sum(rows, 'gross'), discount: sum(rows, 'discount'), net: sum(rows, 'net'), returnsAmount: sum(rows, 'returnsAmount'), netAfterReturns: sum(rows, 'netAfterReturns') },
      meta: { note: 'المردودات تُنسب لتاريخ المردود وليس تاريخ الفاتورة' },
    };
  }

  async salesBy(dim: SalesDim, f: ReportFilters): Promise<ReportResult> {
    const lim = this.limit(f);
    if (dim === 'product' || dim === 'company') {
      const conds = this.invConds(f, 'i."invoiceDate"');
      if (f.productId) conds.push(Prisma.sql`ii."productId" = ${f.productId}`);
      if (f.companyId) conds.push(Prisma.sql`p."companyId" = ${f.companyId}`);
      const grp = dim === 'product'
        ? { sel: Prisma.sql`p.id AS id, p.sku AS code, p."nameAr" AS name`, by: Prisma.sql`p.id, p.sku, p."nameAr"`, join: Prisma.empty }
        : { sel: Prisma.sql`co.id AS id, NULL::text AS code, co.name AS name`, by: Prisma.sql`co.id, co.name`, join: Prisma.sql`JOIN companies co ON co.id = p."companyId"` };
      const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT ${grp.sel}, COUNT(DISTINCT i.id)::int AS invoices, COALESCE(SUM(ii.quantity),0)::bigint AS quantity, COALESCE(SUM(ii."bonusQuantity"),0)::bigint AS "bonusQuantity",
               COALESCE(SUM(ii."grossAmount"),0)::bigint AS gross, COALESCE(SUM(ii."discountAmount"),0)::bigint AS discount, COALESCE(SUM(ii."lineTotal"),0)::bigint AS net,
               COALESCE(SUM(ii."returnedQuantity"),0)::bigint AS "returnedQuantity"
        FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId" JOIN customers c ON c.id = i."customerId" JOIN products p ON p.id = ii."productId" ${grp.join}
        ${this.where(conds)} GROUP BY ${grp.by} ORDER BY net DESC LIMIT ${lim}`);
      return {
        title: dim === 'product' ? 'المبيعات حسب المنتج' : 'المبيعات حسب الشركة',
        columns: [{ key: 'code', header: 'الرمز' }, { key: 'name', header: dim === 'product' ? 'المنتج' : 'الشركة' }, { key: 'invoices', header: 'الفواتير' }, { key: 'quantity', header: 'الكمية المباعة' },
          { key: 'bonusQuantity', header: 'البونص' }, { key: 'returnedQuantity', header: 'الكمية المرتجعة' }, { key: 'gross', header: 'الإجمالي' }, { key: 'discount', header: 'الخصم' }, { key: 'net', header: 'الصافي (مع الضريبة)' }],
        rows, totals: { quantity: sum(rows, 'quantity'), bonusQuantity: sum(rows, 'bonusQuantity'), net: sum(rows, 'net') },
      };
    }
    this.noProductFilters(f, 'هذا التقرير');
    const spec = {
      representative: { sel: Prisma.sql`rep.id AS id, rep."employeeCode" AS code, rep."fullName" AS name`, join: Prisma.sql`LEFT JOIN representatives rep ON rep.id = i."representativeId"`, by: Prisma.sql`rep.id, rep."employeeCode", rep."fullName"`, h: 'المندوب', t: 'المبيعات حسب المندوب' },
      area: { sel: Prisma.sql`a.id AS id, a.city AS code, a.name AS name`, join: Prisma.sql`LEFT JOIN areas a ON a.id = c."areaId"`, by: Prisma.sql`a.id, a.city, a.name`, h: 'المنطقة', t: 'المبيعات حسب المنطقة' },
      customer: { sel: Prisma.sql`c.id AS id, c.code AS code, c.name AS name`, join: Prisma.empty, by: Prisma.sql`c.id, c.code, c.name`, h: 'العميل', t: 'المبيعات حسب العميل' },
    }[dim];
    const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${spec.sel}, COUNT(*)::int AS invoices, COALESCE(SUM(i.subtotal),0)::bigint AS gross, COALESCE(SUM(i."discountTotal"),0)::bigint AS discount,
             COALESCE(SUM(i."netTotal"),0)::bigint AS net, COALESCE(SUM(i."returnedAmount"),0)::bigint AS returned, COALESCE(SUM(i."bonusValue"),0)::bigint AS "bonusValue"
      FROM invoices i JOIN customers c ON c.id = i."customerId" ${spec.join}
      ${this.where(this.invConds(f, 'i."invoiceDate"'))} GROUP BY ${spec.by} ORDER BY net DESC LIMIT ${lim}`);
    const withNet = rows.map((r) => ({ ...r, netAfterReturns: Number(r.net) - Number(r.returned) }));
    return {
      title: spec.t,
      columns: [{ key: 'code', header: 'الرمز' }, { key: 'name', header: spec.h }, { key: 'invoices', header: 'الفواتير' }, { key: 'gross', header: 'الإجمالي' }, { key: 'discount', header: 'الخصم' },
        { key: 'net', header: 'صافي الفواتير' }, { key: 'returned', header: 'المردودات على هذه الفواتير' }, { key: 'netAfterReturns', header: 'الصافي بعد المردودات' }, { key: 'bonusValue', header: 'قيمة البونص' }],
      rows: withNet, totals: { invoices: sum(withNet, 'invoices'), net: sum(withNet, 'net'), returned: sum(withNet, 'returned'), netAfterReturns: sum(withNet, 'netAfterReturns') },
      meta: { note: 'المردودات هنا تُنسب للفاتورة الأصلية' },
    };
  }

  // ───────── financial ─────────

  async receivables(f: ReportFilters): Promise<ReportResult> {
    this.noProductFilters(f, 'تقرير الذمم');
    const conds: Prisma.Sql[] = [Prisma.sql`(c."openingBalance" + COALESCE(l.net, 0)) <> 0`];
    if (f.customerId) conds.push(Prisma.sql`c.id = ${f.customerId}`);
    if (f.areaId) conds.push(Prisma.sql`c."areaId" = ${f.areaId}`);
    if (f.representativeId) conds.push(Prisma.sql`cr."representativeId" = ${f.representativeId}`);
    const from = Prisma.sql`FROM customers c
      LEFT JOIN (SELECT "customerId", SUM(debit) - SUM(credit) AS net FROM ledger_entries GROUP BY 1) l ON l."customerId" = c.id
      LEFT JOIN customer_representatives cr ON cr."customerId" = c.id AND cr."assignedTo" IS NULL AND cr."isPrimary"
      LEFT JOIN representatives rep ON rep.id = cr."representativeId"`;
    const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT c.id, c.code, c.name, rep."fullName" AS "representative", c."creditLimit", (c."openingBalance" + COALESCE(l.net, 0))::bigint AS balance
      ${from} ${this.where(conds)} ORDER BY balance DESC LIMIT ${this.limit(f)}`);
    const tot = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COALESCE(SUM(CASE WHEN b > 0 THEN b ELSE 0 END),0)::bigint AS receivable, COALESCE(SUM(CASE WHEN b < 0 THEN -b ELSE 0 END),0)::bigint AS credit, COUNT(*) FILTER (WHERE b > 0)::int AS debtors
      FROM (SELECT (c."openingBalance" + COALESCE(l.net, 0)) AS b ${from} ${this.where(conds)}) t`)[0];
    const out = rows.map((r) => ({ ...r, overLimit: Number(r.creditLimit) > 0 && Number(r.balance) > Number(r.creditLimit) }));
    return {
      title: 'الذمم المدينة (أرصدة العملاء)',
      columns: [{ key: 'code', header: 'الكود' }, { key: 'name', header: 'العميل' }, { key: 'representative', header: 'المندوب' }, { key: 'balance', header: 'الرصيد' }, { key: 'creditLimit', header: 'الحد الائتماني' }, { key: 'overLimit', header: 'تجاوز الحد' }],
      rows: out, totals: { receivable: Number(tot.receivable), customerCredit: Number(tot.credit), debtors: Number(tot.debtors) },
      meta: { note: 'الرصيد الموجب = على العميل، والسالب = رصيد دائن للعميل' },
    };
  }

  /** Ages are measured from the invoice date to `asOf`; amounts are the CURRENT remaining amounts. */
  async aging(q: AgingQuery): Promise<ReportResult> {
    this.noProductFilters(q, 'تقرير أعمار الديون');
    const asOf = (q.asOf ?? localDate(new Date())).slice(0, 10);
    const conds: Prisma.Sql[] = [Prisma.sql`i.status = 'Confirmed'`, Prisma.sql`i."remainingAmount" > 0`];
    if (q.customerId) conds.push(Prisma.sql`i."customerId" = ${q.customerId}`);
    if (q.areaId) conds.push(Prisma.sql`c."areaId" = ${q.areaId}`);
    if (q.representativeId) conds.push(Prisma.sql`i."representativeId" = ${q.representativeId}`);
    if (q.warehouseId) conds.push(Prisma.sql`i."warehouseId" = ${q.warehouseId}`);
    const age = Prisma.sql`GREATEST(0, (${asOf}::date - ${localDay('i."invoiceDate"')}))`;
    const sel = Prisma.sql`SUM(CASE WHEN a <= 30 THEN amt ELSE 0 END)::bigint AS b30, SUM(CASE WHEN a BETWEEN 31 AND 60 THEN amt ELSE 0 END)::bigint AS b60,
      SUM(CASE WHEN a BETWEEN 61 AND 90 THEN amt ELSE 0 END)::bigint AS b90, SUM(CASE WHEN a > 90 THEN amt ELSE 0 END)::bigint AS b90plus, SUM(amt)::bigint AS total`;
    const base = Prisma.sql`FROM (SELECT i."customerId" AS cid, i."remainingAmount" AS amt, ${age} AS a FROM invoices i JOIN customers c ON c.id = i."customerId" ${this.where(conds)}) o JOIN customers c ON c.id = o.cid`;
    const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT c.id, c.code, c.name, ${sel} ${base} GROUP BY c.id, c.code, c.name ORDER BY total DESC LIMIT ${this.limit(q)}`);
    const tot = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COALESCE(SUM(CASE WHEN a <= 30 THEN amt ELSE 0 END),0)::bigint AS b30, COALESCE(SUM(CASE WHEN a BETWEEN 31 AND 60 THEN amt ELSE 0 END),0)::bigint AS b60,
             COALESCE(SUM(CASE WHEN a BETWEEN 61 AND 90 THEN amt ELSE 0 END),0)::bigint AS b90, COALESCE(SUM(CASE WHEN a > 90 THEN amt ELSE 0 END),0)::bigint AS b90plus, COALESCE(SUM(amt),0)::bigint AS total
      ${base}`)[0] ?? {};
    return {
      title: 'أعمار الديون', rows,
      columns: [{ key: 'code', header: 'الكود' }, { key: 'name', header: 'العميل' }, { key: 'b30', header: '0-30 يوم' }, { key: 'b60', header: '31-60 يوم' }, { key: 'b90', header: '61-90 يوم' }, { key: 'b90plus', header: 'أكثر من 90' }, { key: 'total', header: 'الإجمالي' }],
      totals: { b30: Number(tot.b30 ?? 0), b60: Number(tot.b60 ?? 0), b90: Number(tot.b90 ?? 0), b90plus: Number(tot.b90plus ?? 0), total: Number(tot.total ?? 0) },
      meta: { asOf, note: 'الفواتير المفتوحة فقط؛ الرصيد الافتتاحي والتسديدات غير الموزّعة غير مشمولة (انظر تقرير الذمم)', buckets: ['0-30', '31-60', '61-90', '90+'] },
    };
  }

  async outstandingInvoices(f: PagedReportFilters): Promise<ReportResult> {
    this.noProductFilters(f, 'تقرير الفواتير غير المسددة');
    const page = f.page ?? 1;
    const size = f.format === 'csv' ? CSV_CAP : f.pageSize ?? 50;
    const where: Prisma.InvoiceWhereInput = {
      status: 'Confirmed', remainingAmount: { gt: 0 }, representativeId: f.representativeId, customerId: f.customerId, warehouseId: f.warehouseId,
      customer: f.areaId ? { areaId: f.areaId } : undefined,
      invoiceDate: f.from || f.to ? { gte: f.from ? dayStart(f.from) : undefined, lte: f.to ? dayEnd(f.to) : undefined } : undefined,
    };
    const [items, total, agg] = await this.prisma.$transaction([
      this.prisma.invoice.findMany({ where, orderBy: [{ invoiceDate: 'asc' }, { id: 'asc' }], skip: (page - 1) * size, take: size, include: { customer: { select: { code: true, name: true } } } }),
      this.prisma.invoice.count({ where }),
      this.prisma.invoice.aggregate({ where, _sum: { remainingAmount: true } }),
    ]);
    const today = dayStart(localDate(new Date())).getTime();
    const rows = items.map((i) => ({
      invoiceNumber: i.invoiceNumber, invoiceDate: localDate(i.invoiceDate), customerCode: i.customer.code, customer: i.customer.name,
      netTotal: i.netTotal, paid: i.paidAmount, returned: i.returnedAmount, remaining: i.remainingAmount, ageDays: Math.max(0, Math.floor((today - dayStart(localDate(i.invoiceDate)).getTime()) / 86_400_000)),
    }));
    return {
      title: 'الفواتير غير المسددة',
      columns: [{ key: 'invoiceNumber', header: 'الفاتورة' }, { key: 'invoiceDate', header: 'التاريخ' }, { key: 'customerCode', header: 'كود العميل' }, { key: 'customer', header: 'العميل' }, { key: 'netTotal', header: 'الصافي' },
        { key: 'paid', header: 'المسدّد' }, { key: 'returned', header: 'المردود' }, { key: 'remaining', header: 'المتبقي' }, { key: 'ageDays', header: 'العمر (يوم)' }],
      rows, totals: { remaining: agg._sum.remainingAmount ?? 0 }, meta: { page, pageSize: size, total },
    };
  }

  async collections(f: ReportFilters): Promise<ReportResult> {
    this.noProductFilters(f, 'تقرير التحصيل');
    const r = this.range(f);
    const conds: Prisma.Sql[] = [Prisma.sql`p.status = 'Confirmed'`];
    if (r.from) conds.push(Prisma.sql`p."paymentDate" >= ${r.from}`);
    if (r.to) conds.push(Prisma.sql`p."paymentDate" <= ${r.to}`);
    if (f.representativeId) conds.push(Prisma.sql`p."representativeId" = ${f.representativeId}`);
    if (f.customerId) conds.push(Prisma.sql`p."customerId" = ${f.customerId}`);
    if (f.areaId) conds.push(Prisma.sql`c."areaId" = ${f.areaId}`);
    const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${localDay('p."paymentDate"')} AS day, COUNT(*)::int AS payments, SUM(p.amount)::bigint AS total,
             COALESCE(SUM(CASE WHEN p.method = 'Cash' THEN p.amount END),0)::bigint AS cash, COALESCE(SUM(CASE WHEN p.method = 'Bank' THEN p.amount END),0)::bigint AS bank,
             COALESCE(SUM(CASE WHEN p.method = 'Transfer' THEN p.amount END),0)::bigint AS transfer, COALESCE(SUM(CASE WHEN p.method = 'Other' THEN p.amount END),0)::bigint AS other
      FROM payments p JOIN customers c ON c.id = p."customerId" ${this.where(conds)} GROUP BY 1 ORDER BY 1`);
    const out = rows.map((x) => ({ ...x, day: x.day instanceof Date ? x.day.toISOString().slice(0, 10) : x.day }));
    return {
      title: 'التحصيل اليومي',
      columns: [{ key: 'day', header: 'اليوم' }, { key: 'payments', header: 'عدد التسديدات' }, { key: 'cash', header: 'نقد' }, { key: 'bank', header: 'بنك' }, { key: 'transfer', header: 'حوالة' }, { key: 'other', header: 'أخرى' }, { key: 'total', header: 'الإجمالي' }],
      rows: out, totals: { payments: sum(out, 'payments'), total: sum(out, 'total') },
    };
  }

  // ───────── inventory ─────────

  async inventoryCurrent(q: InventoryCurrentQuery, u: AuthUser): Promise<ReportResult> {
    const seeCost = can(u, 'products.view_cost');
    const page = q.page ?? 1;
    const size = q.format === 'csv' ? CSV_CAP : q.pageSize ?? 50;
    const conds: Prisma.Sql[] = [];
    if (q.warehouseId) conds.push(Prisma.sql`s."warehouseId" = ${q.warehouseId}`);
    if (q.productId) conds.push(Prisma.sql`s."productId" = ${q.productId}`);
    if (q.companyId) conds.push(Prisma.sql`p."companyId" = ${q.companyId}`);
    if (q.lowOnly) conds.push(Prisma.sql`p."reorderLevel" > 0 AND s.quantity < p."reorderLevel"`);
    const from = Prisma.sql`FROM stock s JOIN products p ON p.id = s."productId" JOIN warehouses w ON w.id = s."warehouseId" JOIN companies co ON co.id = p."companyId" ${this.where(conds)}`;
    const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT w.name AS warehouse, p.sku, p."nameAr" AS product, co.name AS company, s.quantity, p."reorderLevel" AS "reorderLevel",
             s."averageCost" AS "averageCost", (s.quantity::bigint * s."averageCost")::bigint AS value
      ${from} ORDER BY p."nameAr", w.name LIMIT ${size} OFFSET ${(page - 1) * size}`);
    const tot = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT COUNT(*)::int AS lines, COALESCE(SUM(s.quantity),0)::bigint AS quantity, COALESCE(SUM(s.quantity::bigint * s."averageCost"),0)::bigint AS value ${from}`)[0];
    const shaped = rows.map((r) => (seeCost ? r : { ...r, averageCost: undefined, value: undefined }));
    return {
      title: 'المخزون الحالي',
      columns: [{ key: 'warehouse', header: 'المخزن' }, { key: 'sku', header: 'الرمز' }, { key: 'product', header: 'المنتج' }, { key: 'company', header: 'الشركة' }, { key: 'quantity', header: 'الكمية' }, { key: 'reorderLevel', header: 'حد إعادة الطلب' },
        ...(seeCost ? [{ key: 'averageCost', header: 'متوسط التكلفة' }, { key: 'value', header: 'القيمة' }] : [])],
      rows: shaped, totals: { lines: Number(tot.lines), quantity: Number(tot.quantity), ...(seeCost ? { value: Number(tot.value) } : {}) }, meta: { page, pageSize: size, total: Number(tot.lines) },
    };
  }

  /** Per product: opening, in, out, closing for the period (stock movement report). */
  async stockMovement(f: ReportFilters): Promise<ReportResult> {
    const r = this.range(f);
    if (!r.from || !r.to) throw new AppException('RANGE_REQUIRED', 'حدّد from و to', 400);
    const conds: Prisma.Sql[] = [Prisma.sql`m."createdAt" <= ${r.to}`];
    if (f.warehouseId) conds.push(Prisma.sql`m."warehouseId" = ${f.warehouseId}`);
    if (f.productId) conds.push(Prisma.sql`m."productId" = ${f.productId}`);
    if (f.companyId) conds.push(Prisma.sql`p."companyId" = ${f.companyId}`);
    const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT p.sku, p."nameAr" AS product,
             COALESCE(SUM(CASE WHEN m."createdAt" < ${r.from} THEN ${SIGNED} ELSE 0 END),0)::bigint AS opening,
             COALESCE(SUM(CASE WHEN m."createdAt" >= ${r.from} AND (${SIGNED}) > 0 THEN ${SIGNED} ELSE 0 END),0)::bigint AS "in",
             COALESCE(SUM(CASE WHEN m."createdAt" >= ${r.from} AND (${SIGNED}) < 0 THEN -(${SIGNED}) ELSE 0 END),0)::bigint AS "out",
             COALESCE(SUM(${SIGNED}),0)::bigint AS closing
      FROM stock_movements m JOIN products p ON p.id = m."productId" ${this.where(conds)}
      GROUP BY p.id, p.sku, p."nameAr" ORDER BY p."nameAr" LIMIT ${this.limit(f)}`);
    return {
      title: 'حركة المخزون', rows,
      columns: [{ key: 'sku', header: 'الرمز' }, { key: 'product', header: 'المنتج' }, { key: 'opening', header: 'أول المدة' }, { key: 'in', header: 'وارد' }, { key: 'out', header: 'صادر' }, { key: 'closing', header: 'آخر المدة' }],
      totals: { opening: sum(rows, 'opening'), in: sum(rows, 'in'), out: sum(rows, 'out'), closing: sum(rows, 'closing') },
    };
  }

  /** Fast movers (most units sold in the window) or slow movers (stock on hand but little/no sales). */
  async movers(q: MoversQuery): Promise<ReportResult> {
    const days = q.days ?? 90;
    const since = new Date(Date.now() - days * 86_400_000);
    const kind = q.kind ?? 'fast';
    const conds: Prisma.Sql[] = [Prisma.sql`p."isActive"`];
    if (q.companyId) conds.push(Prisma.sql`p."companyId" = ${q.companyId}`);
    conds.push(kind === 'fast' ? Prisma.sql`COALESCE(sl.units, 0) > 0` : Prisma.sql`COALESCE(st.q, 0) > 0`);
    const order = kind === 'fast' ? Prisma.sql`units DESC` : Prisma.sql`units ASC, "lastSale" ASC NULLS FIRST`;
    const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT p.sku, p."nameAr" AS product, COALESCE(st.q, 0)::bigint AS stock, COALESCE(sl.units, 0)::bigint AS units, ls.last_sale AS "lastSale"
      FROM products p
      LEFT JOIN (SELECT "productId", SUM(quantity) AS q FROM stock ${q.warehouseId ? Prisma.sql`WHERE "warehouseId" = ${q.warehouseId}` : Prisma.empty} GROUP BY 1) st ON st."productId" = p.id
      LEFT JOIN (SELECT ii."productId", SUM(ii.quantity) AS units FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId" WHERE i.status = 'Confirmed' AND i."invoiceDate" >= ${since} GROUP BY 1) sl ON sl."productId" = p.id
      LEFT JOIN (SELECT ii."productId", MAX(i."invoiceDate") AS last_sale FROM invoice_items ii JOIN invoices i ON i.id = ii."invoiceId" WHERE i.status = 'Confirmed' GROUP BY 1) ls ON ls."productId" = p.id
      ${this.where(conds)} ORDER BY ${order} LIMIT ${this.limit(q)}`);
    const out = rows.map((r) => ({ ...r, lastSale: r.lastSale ? localDate(r.lastSale as Date) : null }));
    return {
      title: kind === 'fast' ? `الأصناف الأسرع حركة (آخر ${days} يوماً)` : `الأصناف بطيئة الحركة (آخر ${days} يوماً)`, rows: out,
      columns: [{ key: 'sku', header: 'الرمز' }, { key: 'product', header: 'المنتج' }, { key: 'stock', header: 'المخزون' }, { key: 'units', header: `المباع خلال ${days} يوماً` }, { key: 'lastSale', header: 'آخر بيع' }],
      meta: { days, kind },
    };
  }

  // ───────── representatives ─────────

  async repPerformance(f: ReportFilters): Promise<ReportResult> {
    this.noProductFilters(f, 'تقرير أداء المندوبين');
    const r = this.range(f);
    const rangeOf = (col: string) => [r.from ? Prisma.sql`${Prisma.raw(col)} >= ${r.from}` : Prisma.sql`TRUE`, r.to ? Prisma.sql`${Prisma.raw(col)} <= ${r.to}` : Prisma.sql`TRUE`];
    const [vf, vt] = [f.from ? Prisma.sql`v."visitDate" >= ${f.from.slice(0, 10)}::date` : Prisma.sql`TRUE`, f.to ? Prisma.sql`v."visitDate" <= ${f.to.slice(0, 10)}::date` : Prisma.sql`TRUE`];
    const [of, ot] = rangeOf('o."orderDate"');
    const [inf, int] = rangeOf('i."invoiceDate"');
    const [pf, pt] = rangeOf('p."paymentDate"');
    const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT rep.id, rep."employeeCode" AS code, rep."fullName" AS name, rep.status::text AS status,
             COALESCE(v.visits,0)::int AS visits, COALESCE(v.customers,0)::int AS "visitedCustomers", COALESCE(v.verified,0)::int AS "verifiedVisits", COALESCE(v.flagged,0)::int AS "flaggedVisits",
             COALESCE(o.orders,0)::int AS orders, COALESCE(o.total,0)::bigint AS "ordersValue",
             COALESCE(i.invoices,0)::int AS invoices, COALESCE(i.net,0)::bigint AS sales, COALESCE(i.returned,0)::bigint AS returned,
             COALESCE(p.total,0)::bigint AS collections
      FROM representatives rep
      LEFT JOIN (SELECT v."representativeId" AS rid, COUNT(*) AS visits, COUNT(DISTINCT v."customerId") AS customers,
                        COUNT(*) FILTER (WHERE v."locationStatus" = 'Verified') AS verified, COUNT(*) FILTER (WHERE v."locationStatus" IN ('TooFar','PoorAccuracy')) AS flagged
                 FROM visits v WHERE ${vf} AND ${vt} GROUP BY 1) v ON v.rid = rep.id
      LEFT JOIN (SELECT o."representativeId" AS rid, COUNT(*) AS orders, SUM(o.total) AS total FROM sales_orders o WHERE o.status <> 'Cancelled' AND ${of} AND ${ot} GROUP BY 1) o ON o.rid = rep.id
      LEFT JOIN (SELECT i."representativeId" AS rid, COUNT(*) AS invoices, SUM(i."netTotal") AS net, SUM(i."returnedAmount") AS returned FROM invoices i WHERE i.status = 'Confirmed' AND ${inf} AND ${int} GROUP BY 1) i ON i.rid = rep.id
      LEFT JOIN (SELECT p."representativeId" AS rid, SUM(p.amount) AS total FROM payments p WHERE p.status = 'Confirmed' AND ${pf} AND ${pt} GROUP BY 1) p ON p.rid = rep.id
      ${f.representativeId ? Prisma.sql`WHERE rep.id = ${f.representativeId}` : Prisma.empty}
      ORDER BY sales DESC, rep."fullName"`);
    const out = rows.map((x) => ({ ...x, netSales: Number(x.sales) - Number(x.returned) }));
    return {
      title: 'أداء المندوبين', rows: out,
      columns: [{ key: 'code', header: 'الكود' }, { key: 'name', header: 'المندوب' }, { key: 'visits', header: 'الزيارات' }, { key: 'visitedCustomers', header: 'عملاء تمت زيارتهم' }, { key: 'verifiedVisits', header: 'زيارات موثّقة' }, { key: 'flaggedVisits', header: 'زيارات مشكوك بها' },
        { key: 'orders', header: 'الطلبات' }, { key: 'ordersValue', header: 'قيمة الطلبات' }, { key: 'invoices', header: 'الفواتير' }, { key: 'sales', header: 'المبيعات' }, { key: 'returned', header: 'المردودات' }, { key: 'netSales', header: 'الصافي' }, { key: 'collections', header: 'التحصيل' }],
      totals: { visits: sum(out, 'visits'), orders: sum(out, 'orders'), sales: sum(out, 'sales'), netSales: sum(out, 'netSales'), collections: sum(out, 'collections') },
    };
  }

  /** Targets covering `date`: achieved amount/visits/orders inside each target's own period, to the end of that day. */
  async targetAchievement(q: TargetQuery): Promise<ReportResult> {
    const date = (q.date ?? localDate(new Date())).slice(0, 10);
    const day = new Date(date);
    const targets = await this.prisma.salesTarget.findMany({
      where: { representativeId: q.representativeId, startDate: { lte: day }, endDate: { gte: day } },
      include: { representative: { select: { id: true, employeeCode: true, fullName: true } } }, orderBy: { startDate: 'asc' }, take: 500,
    });
    const rows: Record<string, unknown>[] = [];
    for (const t of targets) {
      const s = t.startDate.toISOString().slice(0, 10);
      const e = t.endDate.toISOString().slice(0, 10);
      const upto = dayEnd(date < e ? date : e);
      const [inv, visits, orders] = await Promise.all([
        this.prisma.invoice.aggregate({ where: { representativeId: t.representativeId, status: 'Confirmed', invoiceDate: { gte: dayStart(s), lte: upto } }, _sum: { netTotal: true, returnedAmount: true } }),
        this.prisma.visit.count({ where: { representativeId: t.representativeId, visitDate: { gte: t.startDate, lte: new Date(date < e ? date : e) } } }),
        this.prisma.salesOrder.count({ where: { representativeId: t.representativeId, status: { not: 'Cancelled' }, orderDate: { gte: dayStart(s), lte: upto } } }),
      ]);
      const achieved = (inv._sum.netTotal ?? 0) - (inv._sum.returnedAmount ?? 0);
      rows.push({
        code: t.representative.employeeCode, representative: t.representative.fullName, periodType: t.periodType, startDate: s, endDate: e,
        targetAmount: t.targetAmount, achievedAmount: achieved, amountPct: percent(achieved, t.targetAmount),
        targetVisits: t.targetVisits, achievedVisits: visits, visitsPct: percent(visits, t.targetVisits),
        targetOrders: t.targetOrders, achievedOrders: orders, ordersPct: percent(orders, t.targetOrders),
      });
    }
    return {
      title: 'تحقيق الأهداف', rows,
      columns: [{ key: 'code', header: 'الكود' }, { key: 'representative', header: 'المندوب' }, { key: 'periodType', header: 'نوع الفترة' }, { key: 'startDate', header: 'من' }, { key: 'endDate', header: 'إلى' },
        { key: 'targetAmount', header: 'هدف المبيعات' }, { key: 'achievedAmount', header: 'المحقق' }, { key: 'amountPct', header: 'النسبة %' }, { key: 'targetVisits', header: 'هدف الزيارات' }, { key: 'achievedVisits', header: 'الزيارات' }, { key: 'visitsPct', header: 'نسبة الزيارات %' },
        { key: 'targetOrders', header: 'هدف الطلبات' }, { key: 'achievedOrders', header: 'الطلبات' }, { key: 'ordersPct', header: 'نسبة الطلبات %' }],
      meta: { date, note: 'المحقق = صافي المبيعات بعد المردودات من بداية فترة الهدف حتى التاريخ' },
    };
  }

  /** Plan entries that were due and not done (Planned or Skipped), before today. */
  async missedVisits(f: PagedReportFilters): Promise<ReportResult> {
    const today = new Date(localDate(new Date()));
    const page = f.page ?? 1;
    const size = f.format === 'csv' ? CSV_CAP : f.pageSize ?? 50;
    const to = f.to ? new Date(f.to.slice(0, 10)) : undefined;
    const where: Prisma.VisitPlanWhereInput = {
      status: { in: ['Planned', 'Skipped'] }, representativeId: f.representativeId, customerId: f.customerId,
      customer: f.areaId ? { areaId: f.areaId } : undefined,
      planDate: { gte: f.from ? new Date(f.from.slice(0, 10)) : undefined, lt: to && to < today ? new Date(to.getTime() + 86_400_000) : today },
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.visitPlan.findMany({ where, orderBy: [{ planDate: 'desc' }, { plannedOrder: 'asc' }], skip: (page - 1) * size, take: size, include: { customer: { select: { code: true, name: true } }, representative: { select: { employeeCode: true, fullName: true } } } }),
      this.prisma.visitPlan.count({ where }),
    ]);
    const rows = items.map((p) => ({ date: p.planDate.toISOString().slice(0, 10), representative: p.representative.fullName, customerCode: p.customer.code, customer: p.customer.name, status: p.status }));
    return {
      title: 'الزيارات الفائتة', rows,
      columns: [{ key: 'date', header: 'التاريخ' }, { key: 'representative', header: 'المندوب' }, { key: 'customerCode', header: 'كود العميل' }, { key: 'customer', header: 'العميل' }, { key: 'status', header: 'الحالة' }],
      meta: { page, pageSize: size, total },
    };
  }

  // ───────── returns ─────────

  async returnsBy(dim: ReturnsDim, f: ReportFilters): Promise<ReportResult> {
    const lim = this.limit(f);
    const r = this.range(f);
    const conds: Prisma.Sql[] = [];
    if (r.from) conds.push(Prisma.sql`r."returnDate" >= ${r.from}`);
    if (r.to) conds.push(Prisma.sql`r."returnDate" <= ${r.to}`);
    if (f.customerId) conds.push(Prisma.sql`r."customerId" = ${f.customerId}`);
    if (f.representativeId) conds.push(Prisma.sql`i."representativeId" = ${f.representativeId}`);
    if (f.areaId) conds.push(Prisma.sql`c."areaId" = ${f.areaId}`);
    if (f.warehouseId) conds.push(Prisma.sql`r."warehouseId" = ${f.warehouseId}`);

    if (dim === 'product') {
      if (f.productId) conds.push(Prisma.sql`ri."productId" = ${f.productId}`);
      if (f.companyId) conds.push(Prisma.sql`p."companyId" = ${f.companyId}`);
      const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
        SELECT p.sku AS code, p."nameAr" AS name, COUNT(DISTINCT r.id)::int AS returns,
               COALESCE(SUM(CASE WHEN ri."lineType" = 'Sold' THEN ri.quantity END),0)::bigint AS "soldQuantity",
               COALESCE(SUM(CASE WHEN ri."lineType" IN ('Bonus','BonusBilled') THEN ri.quantity END),0)::bigint AS "bonusQuantity",
               COALESCE(SUM(CASE WHEN ri."lineType" = 'Sold' THEN ri.amount END),0)::bigint AS credit,
               COALESCE(SUM(CASE WHEN ri.condition <> 'Valid' THEN ri.quantity END),0)::bigint AS "writtenOffQuantity"
        FROM return_items ri JOIN returns r ON r.id = ri."returnId" JOIN invoices i ON i.id = r."invoiceId" JOIN customers c ON c.id = r."customerId" JOIN products p ON p.id = ri."productId"
        ${this.where(conds)} GROUP BY p.id, p.sku, p."nameAr" ORDER BY credit DESC LIMIT ${lim}`);
      return { title: 'المردودات حسب المنتج', rows,
        columns: [{ key: 'code', header: 'الرمز' }, { key: 'name', header: 'المنتج' }, { key: 'returns', header: 'عدد المردودات' }, { key: 'soldQuantity', header: 'كمية مباعة مرتجعة' }, { key: 'bonusQuantity', header: 'بونص مرتجع/محاسَب' }, { key: 'writtenOffQuantity', header: 'تالف/منتهٍ' }, { key: 'credit', header: 'قيمة المردود' }],
        totals: { returns: sum(rows, 'returns'), credit: sum(rows, 'credit') } };
    }
    this.noProductFilters(f, 'هذا التقرير');
    const spec = {
      customer: { sel: Prisma.sql`c.code AS code, c.name AS name`, by: Prisma.sql`c.id, c.code, c.name`, join: Prisma.empty, h: 'العميل', t: 'المردودات حسب العميل' },
      representative: { sel: Prisma.sql`rep."employeeCode" AS code, rep."fullName" AS name`, by: Prisma.sql`rep.id, rep."employeeCode", rep."fullName"`, join: Prisma.sql`LEFT JOIN representatives rep ON rep.id = i."representativeId"`, h: 'المندوب', t: 'المردودات حسب المندوب' },
      invoice: { sel: Prisma.sql`i."invoiceNumber" AS code, c.name AS name`, by: Prisma.sql`i.id, i."invoiceNumber", c.name`, join: Prisma.empty, h: 'العميل', t: 'المردودات حسب الفاتورة' },
    }[dim];
    const rows = plain(await this.prisma.$queryRaw<Record<string, unknown>[]>`
      SELECT ${spec.sel}, COUNT(*)::int AS returns, COALESCE(SUM(r."creditAmount"),0)::bigint AS credit, COALESCE(SUM(r."billedAmount"),0)::bigint AS billed
      FROM returns r JOIN invoices i ON i.id = r."invoiceId" JOIN customers c ON c.id = r."customerId" ${spec.join}
      ${this.where(conds)} GROUP BY ${spec.by} ORDER BY credit DESC LIMIT ${lim}`);
    const out = rows.map((x) => ({ ...x, netCredit: Number(x.credit) - Number(x.billed) }));
    return { title: spec.t, rows: out,
      columns: [{ key: 'code', header: dim === 'invoice' ? 'الفاتورة' : 'الرمز' }, { key: 'name', header: spec.h }, { key: 'returns', header: 'عدد المردودات' }, { key: 'credit', header: 'قيمة المردود' }, { key: 'billed', header: 'بونص محاسَب عليه' }, { key: 'netCredit', header: 'الصافي' }],
      totals: { returns: sum(out, 'returns'), credit: sum(out, 'credit'), netCredit: sum(out, 'netCredit') } };
  }
}

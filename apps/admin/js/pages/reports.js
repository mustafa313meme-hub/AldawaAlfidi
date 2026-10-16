import { api, download, lookup } from '../api.js';
import { buildForm, errorBox, fmtNum, h, monthStartLocal, put, spinner, table, todayLocal } from '../dom.js';

export const title = 'التقارير';

const P = {
  from: { name: 'from', label: 'من تاريخ', type: 'date' }, to: { name: 'to', label: 'إلى تاريخ', type: 'date' },
  rep: { name: 'representativeId', label: 'المندوب', type: 'select', load: () => lookup('/representatives', (r) => `${r.employeeCode} — ${r.fullName}`) },
  area: { name: 'areaId', label: 'المنطقة', type: 'select', load: () => lookup('/areas', (a) => `${a.city} — ${a.name}`) },
  company: { name: 'companyId', label: 'الشركة', type: 'select', load: () => lookup('/companies', 'name') },
  wh: { name: 'warehouseId', label: 'المخزن', type: 'select', load: () => lookup('/warehouses', 'name') },
  asOf: { name: 'asOf', label: 'حتى تاريخ', type: 'date' }, date: { name: 'date', label: 'بتاريخ', type: 'date' },
  low: { name: 'lowOnly', label: 'المنخفض فقط', type: 'checkbox' },
  kind: { name: 'kind', label: 'النوع', type: 'select', options: [{ value: 'fast', label: 'الأسرع حركة' }, { value: 'slow', label: 'بطيء الحركة' }] },
  days: { name: 'days', label: 'عدد الأيام', type: 'number', min: 1 },
};
const salesP = [P.from, P.to, P.rep, P.area, P.wh];

export const CATALOG = [
  { g: 'المبيعات', perm: 'reports.sales', items: [
    { k: 'sd', t: 'المبيعات اليومية', path: '/reports/sales/daily', p: salesP }, { k: 'sm', t: 'المبيعات الشهرية', path: '/reports/sales/monthly', p: salesP },
    { k: 'sr', t: 'حسب المندوب', path: '/reports/sales/by/representative', p: salesP }, { k: 'sa', t: 'حسب المنطقة', path: '/reports/sales/by/area', p: salesP },
    { k: 'sc', t: 'حسب العميل', path: '/reports/sales/by/customer', p: salesP }, { k: 'sp', t: 'حسب المنتج', path: '/reports/sales/by/product', p: [P.from, P.to, P.company, P.rep, P.area, P.wh] },
    { k: 'sco', t: 'حسب الشركة', path: '/reports/sales/by/company', p: [P.from, P.to, P.rep, P.area, P.wh] },
    { k: 'rc', t: 'المردودات حسب العميل', path: '/reports/returns/by/customer', p: [P.from, P.to, P.rep, P.area] }, { k: 'rr', t: 'المردودات حسب المندوب', path: '/reports/returns/by/representative', p: [P.from, P.to, P.area] },
    { k: 'rp', t: 'المردودات حسب المنتج', path: '/reports/returns/by/product', p: [P.from, P.to, P.company, P.rep] }, { k: 'ri', t: 'المردودات حسب الفاتورة', path: '/reports/returns/by/invoice', p: [P.from, P.to, P.rep] },
  ] },
  { g: 'المالية', perm: 'reports.financial', items: [
    { k: 'fr', t: 'الذمم المدينة', path: '/reports/financial/receivables', p: [P.rep, P.area] }, { k: 'fa', t: 'أعمار الديون', path: '/reports/financial/aging', p: [P.asOf, P.rep, P.area] },
    { k: 'fo', t: 'الفواتير غير المسددة', path: '/reports/financial/outstanding-invoices', p: [P.from, P.to, P.rep, P.area] }, { k: 'fc', t: 'التحصيل اليومي', path: '/reports/financial/collections', p: [P.from, P.to, P.rep, P.area] },
  ] },
  { g: 'المخزون', perm: 'reports.inventory', items: [
    { k: 'ic', t: 'المخزون الحالي', path: '/reports/inventory/current', p: [P.wh, P.company, P.low] }, { k: 'im', t: 'حركة المخزون', path: '/reports/inventory/movement', p: [{ ...P.from, required: true }, { ...P.to, required: true }, P.wh, P.company] },
    { k: 'iv', t: 'الأصناف الأسرع/الأبطأ حركة', path: '/reports/inventory/movers', p: [P.kind, P.days, P.company, P.wh] },
  ] },
  { g: 'المندوبون', perm: 'reports.representatives', items: [
    { k: 'pp', t: 'أداء المندوبين', path: '/reports/representatives/performance', p: [P.from, P.to, P.rep] }, { k: 'pt', t: 'تحقيق الأهداف', path: '/reports/representatives/target-achievement', p: [P.date, P.rep] },
    { k: 'pm', t: 'الزيارات الفائتة', path: '/reports/representatives/missed-visits', p: [P.from, P.to, P.rep, P.area] },
  ] },
];

const cell = (v) => (typeof v === 'number' ? fmtNum(v) : typeof v === 'boolean' ? (v ? 'نعم' : 'لا') : v === null || v === undefined ? '' : String(v));

export default async function render(ctx) {
  const groups = CATALOG.filter((g) => ctx.can(g.perm));
  const chosen = groups.flatMap((g) => g.items).find((i) => i.k === ctx.query.r);
  const nav = h('div', { class: 'card rep-list' }, groups.map((g) => [h('div', { class: 'gt' }, g.g), g.items.map((i) => h('a', { href: '#/reports?r=' + i.k, class: chosen && chosen.k === i.k ? 'on' : '' }, i.t))]));
  const out = h('div', {});
  ctx.root.append(h('h2', {}, 'التقارير'), h('div', { class: 'rep-split' }, nav, out));
  if (!chosen) { out.append(h('p', { class: 'note' }, groups.length ? 'اختر تقريراً من القائمة.' : 'ليست لديك صلاحية أي تقرير.')); return; }

  const initial = { from: monthStartLocal(), to: todayLocal(), asOf: todayLocal(), date: todayLocal(), days: 90 };
  const form = buildForm(chosen.p, initial);
  const result = h('div');
  const run = async () => {
    if (!form.validate()) return;
    result.replaceChildren(spinner());
    try {
      const { data } = await api('GET', chosen.path, { query: form.values() });
      const rows = data.rows || [];
      const first = rows[0] || {};
      const cols = data.columns.map((c) => ({ key: c.key, label: c.header, num: typeof first[c.key] === 'number', fmt: cell }));
      const tot = data.totals ? Object.entries(data.totals).map(([k, v]) => `${(data.columns.find((c) => c.key === k) || { header: k }).header}: ${fmtNum(v)}`) : [];
      put(result, h('h3', {}, data.title), table(cols, rows),
        tot.length ? h('div', { class: 'card' }, h('strong', {}, 'الإجماليات: '), tot.join('  |  ')) : null, data.meta && data.meta.note ? h('p', { class: 'note' }, data.meta.note) : null);
    } catch (e) { result.replaceChildren(errorBox(e)); }
  };
  const csv = h('button', { class: 'btn sec', type: 'button', onclick: async () => {
    if (!form.validate()) return;
    try { await download(chosen.path, { ...form.values(), format: 'csv' }, `${chosen.k}-${todayLocal()}.csv`); } catch (e) { result.replaceChildren(errorBox(e)); }
  } }, 'تصدير CSV (Excel)');
  out.append(h('h3', {}, chosen.t), h('div', { class: 'card' }, form.el, h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: run }, 'عرض'), csv)), result);
}

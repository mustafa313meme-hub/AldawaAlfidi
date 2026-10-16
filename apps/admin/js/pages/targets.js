// Sales targets per representative (amount / visits / orders). Achievement vs target lives in the report «تحقيق الأهداف».
import { api, lookup } from '../api.js';
import { UserError, fmtDate, fmtNum, h, monthStartLocal, todayLocal } from '../dom.js';
import { L, lbl } from '../labels.js';
import { formModal, resourceList } from '../resource.js';

export const title = 'أهداف المبيعات';

const day = (v) => (v ? String(v).slice(0, 10) : '');
const periodOpts = Object.entries(L.targetPeriod).map(([value, label]) => ({ value, label }));
const num = (name, label) => ({ name, label, type: 'number', min: 0 });
const repOf = () => lookup('/representatives', (r) => `${r.employeeCode} — ${r.fullName}`);

function monthEnd() { const d = new Date(monthStartLocal()); d.setUTCMonth(d.getUTCMonth() + 1, 0); return d.toISOString().slice(0, 10); }

export default async function render(ctx) {
  const manage = ctx.can('targets.manage');
  const fields = (edit) => [
    { name: 'representativeId', label: 'المندوب', type: 'select', required: true, load: repOf },
    { name: 'periodType', label: 'الفترة', type: 'select', required: true, options: periodOpts },
    { name: 'startDate', label: 'من تاريخ', type: 'date', required: true }, { name: 'endDate', label: 'إلى تاريخ', type: 'date', required: true },
    num('targetAmount', 'هدف المبيعات (مبلغ)'), num('targetVisits', 'هدف الزيارات'), num('targetOrders', 'هدف الطلبات'),
    { name: 'notes', label: 'ملاحظات', full: true },
  ].filter((f) => !(edit && f.name === 'representativeId'));
  const check = (v) => { if (v.endDate < v.startDate) throw new UserError('تاريخ النهاية قبل البداية'); if (![v.targetAmount, v.targetVisits, v.targetOrders].some((x) => x > 0)) throw new UserError('حدّد هدفاً واحداً على الأقل (مبلغ أو زيارات أو طلبات)'); };
  const reps = manage ? await repOf().catch(() => []) : [];
  await resourceList({
    title: 'أهداف المبيعات', endpoint: '/sales-targets',
    filters: reps.length ? [{ name: 'representativeId', label: 'المندوب', options: reps }] : [],
    columns: [
      { key: 'representative', label: 'المندوب', fmt: (v) => (v ? v.fullName : '') }, { key: 'periodType', label: 'الفترة', fmt: (v) => lbl(L.targetPeriod, v) },
      { key: 'startDate', label: 'من', fmt: fmtDate }, { key: 'endDate', label: 'إلى', fmt: fmtDate },
      { key: 'targetAmount', label: 'هدف المبيعات', num: true, fmt: fmtNum }, { key: 'targetVisits', label: 'الزيارات', num: true, fmt: fmtNum }, { key: 'targetOrders', label: 'الطلبات', num: true, fmt: fmtNum }, { key: 'notes', label: 'ملاحظات' },
    ],
    extraTools: () => (ctx.can('reports.representatives') ? h('a', { class: 'btn sec', href: '#/reports?r=pt' }, 'تقرير تحقيق الأهداف') : h('span')),
    onRow: manage ? (r, reload) => formModal({ title: 'تعديل الهدف', fields: fields(true), initial: { ...r, startDate: day(r.startDate), endDate: day(r.endDate) }, wide: true,
      submit: (v) => { check({ ...r, ...v, startDate: v.startDate || day(r.startDate), endDate: v.endDate || day(r.endDate) }); return api('PATCH', `/sales-targets/${r.id}`, { body: v }); }, onDone: reload }) : undefined,
    create: { label: 'هدف جديد', perm: 'targets.manage', open: (reload) => formModal({ title: 'هدف جديد', fields: fields(false), initial: { periodType: 'Monthly', startDate: monthStartLocal(), endDate: monthEnd() }, wide: true,
      submit: (v) => { check(v); return api('POST', '/sales-targets', { body: v }); }, onDone: reload }) },
  })(ctx);
}
void todayLocal;

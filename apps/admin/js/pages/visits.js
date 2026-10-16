// Field visits: list with filters + detail (location evidence) + limited edit. Visits are never deleted (they are evidence of field work).
import { api, lookup } from '../api.js';
import { badge, fmtDate, fmtDateTime, fmtNum, h, kv, modal, todayLocal } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { formModal, resourceList } from '../resource.js';

export const title = 'زيارات المندوبين';

const opts = (m) => Object.entries(m).map(([value, label]) => ({ value, label }));
const day = (v) => (v ? String(v).slice(0, 10) : '');

/** Plain link to a map app for a coordinate pair (no embedded tiles: the CSP forbids third-party content). */
export const mapLink = (lat, lng) => (lat == null || lng == null ? '—' : h('a', { href: `https://www.google.com/maps?q=${Number(lat)},${Number(lng)}`, target: '_blank', rel: 'noopener noreferrer' }, `${Number(lat).toFixed(5)}, ${Number(lng).toFixed(5)}`));

export default async function render(ctx) {
  const reps = ctx.can('visits.view_all') ? await lookup('/representatives', (r) => `${r.employeeCode} — ${r.fullName}`).catch(() => []) : [];
  await resourceList({
    title: 'زيارات المندوبين', endpoint: '/visits',
    filters: [
      ...(reps.length ? [{ name: 'representativeId', label: 'المندوب', options: reps }] : []),
      { name: 'from', label: 'من تاريخ', type: 'date' }, { name: 'to', label: 'إلى تاريخ', type: 'date' },
      { name: 'visitType', label: 'النوع', options: opts(L.visitType) },
      { name: 'locationStatus', label: 'الموقع', options: opts(L.locStatus) },
    ],
    columns: [
      { key: 'startTime', label: 'الوقت', fmt: fmtDateTime },
      { key: 'representative', label: 'المندوب', fmt: (v) => (v ? v.fullName : '') },
      { key: 'customer', label: 'العميل', fmt: (v) => (v ? `${v.code} — ${v.name}` : '') },
      { key: 'visitType', label: 'النوع', fmt: (v) => lbl(L.visitType, v) },
      { key: 'outcome', label: 'النتيجة' },
      { key: 'locationStatus', label: 'الموقع', render: (r) => badge(lbl(L.locStatus, r.locationStatus), kind(L.locStatus, r.locationStatus)) },
      { key: 'distanceM', label: 'البعد (م)', num: true, fmt: (v) => (v == null ? '' : fmtNum(v)) },
    ],
    onRow: (r, reload) => openVisit(r.id, ctx, reload),
  })(ctx);
}

async function openVisit(id, ctx, reload) {
  const { data: v } = await api('GET', `/visits/${id}`);
  const editable = ctx.can('visits.update');
  const m = modal({
    title: `زيارة ${fmtDate(v.visitDate)} — ${v.customer ? v.customer.name : ''}`, wide: true,
    body: h('div', {}, kv([
      ['المندوب', v.representative && v.representative.fullName], ['العميل', v.customer && `${v.customer.code} — ${v.customer.name}`],
      ['النوع', lbl(L.visitType, v.visitType)], ['البدء', fmtDateTime(v.startTime)], ['الانتهاء', fmtDateTime(v.endTime)],
      ['النتيجة', v.outcome], ['الزيارة القادمة', fmtDate(v.nextVisitDate)], ['ملاحظات', v.notes],
      ['حالة الموقع', badge(lbl(L.locStatus, v.locationStatus), kind(L.locStatus, v.locationStatus))],
      ['البعد عن العميل', v.distanceM == null ? null : `${fmtNum(v.distanceM)} م`], ['دقة القراءة', v.accuracyM == null ? null : `${fmtNum(v.accuracyM)} م`],
      ['الإحداثيات', mapLink(v.latitude, v.longitude)], ['وقت قراءة الموقع', fmtDateTime(v.locationAt)],
    ]), h('p', { class: 'note' }, 'الموقع دليل لا إثبات: «موقع مؤكَّد» يعني قراءة دقيقة وقريبة من العميل فقط.')),
    actions: [
      editable ? { label: 'تعديل', onClick: (close) => {
        close();
        formModal({
          title: 'تعديل الزيارة', wide: true,
          fields: [{ name: 'visitType', label: 'النوع', type: 'select', options: opts(L.visitType) }, { name: 'outcome', label: 'النتيجة' }, { name: 'nextVisitDate', label: 'الزيارة القادمة', type: 'date' }, { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true }],
          initial: { ...v, nextVisitDate: day(v.nextVisitDate) }, submit: (b) => api('PATCH', `/visits/${id}`, { body: b }), onDone: reload,
        });
      } } : null,
      { label: 'إغلاق', kind: 'sec', onClick: (c) => c() },
    ].filter(Boolean),
  });
  return m;
}
void todayLocal;

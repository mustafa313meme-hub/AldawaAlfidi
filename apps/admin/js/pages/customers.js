import { api, lookup } from '../api.js';
import { badge, fmtNum, h } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { formModal, resourceList } from '../resource.js';

export const title = 'العملاء';

export const customerFields = (can, edit) => [
  { name: 'name', label: 'اسم العميل', required: true, full: true },
  { name: 'customerType', label: 'النوع', type: 'select', options: Object.entries(L.customerType).map(([value, label]) => ({ value, label })) },
  { name: 'phone', label: 'الهاتف', placeholder: '07xxxxxxxxx' },
  { name: 'secondaryPhone', label: 'هاتف ثانٍ' },
  { name: 'address', label: 'العنوان', full: true },
  { name: 'city', label: 'المدينة' },
  { name: 'district', label: 'الحي' },
  { name: 'areaId', label: 'المنطقة', type: 'select', load: () => lookup('/areas', (a) => `${a.city} — ${a.name}`) },
  { name: 'ownerName', label: 'اسم المالك/الطبيب' },
  { name: 'licenseNumber', label: 'رقم الإجازة' },
  { name: 'latitude', label: 'خط العرض', type: 'number' },
  { name: 'longitude', label: 'خط الطول', type: 'number' },
  ...(can('customers.manage_credit') ? [
    { name: 'creditLimit', label: 'الحد الائتماني (0 = بلا حد)', type: 'number', min: 0 },
    ...(edit ? [] : [{ name: 'openingBalance', label: 'الرصيد الافتتاحي', type: 'number' }]),
    { name: 'priceListId', label: 'قائمة الأسعار', type: 'select', load: () => lookup('/price-lists', 'name') },
    ...(edit ? [{ name: 'status', label: 'الحالة', type: 'select', options: Object.entries(L.customerStatus).map(([value, label]) => ({ value, label })) }] : []),
  ] : []),
  ...(!edit && can('customers.assign') ? [{ name: 'assignedRepresentativeId', label: 'المندوب', type: 'select', load: () => lookup('/representatives', (r) => `${r.employeeCode} — ${r.fullName}`) }] : []),
  { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
];

export default async function render(ctx) {
  const list = resourceList({
    title: 'العملاء', endpoint: '/customers', search: true,
    filters: [{ name: 'status', label: 'الحالة', options: Object.entries(L.customerStatus).map(([value, label]) => ({ value, label })) },
      { name: 'customerType', label: 'النوع', options: Object.entries(L.customerType).map(([value, label]) => ({ value, label })) }],
    columns: [
      { key: 'code', label: 'الكود' }, { key: 'name', label: 'الاسم' },
      { key: 'customerType', label: 'النوع', fmt: (v) => lbl(L.customerType, v) },
      { key: 'phone', label: 'الهاتف' },
      { key: 'assignedRepresentative', label: 'المندوب', fmt: (v) => (v ? v.fullName : '—') },
      { key: 'status', label: 'الحالة', render: (r) => badge(lbl(L.customerStatus, r.status), kind(L.customerStatus, r.status)) },
    ],
    onRow: (r) => ctx.navigate('/customers/' + r.id),
    create: {
      label: 'عميل جديد', perm: 'customers.create',
      open: (reload) => formModal({ title: 'عميل جديد', fields: customerFields(ctx.can, false), wide: true, submit: (v) => api('POST', '/customers', { body: v }), onDone: reload }),
    },
  });
  await list(ctx);
}

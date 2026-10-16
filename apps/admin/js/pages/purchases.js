import { badge, fmtDateTime, fmtNum } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { resourceList } from '../resource.js';

export const title = 'المشتريات';

export default async function render(ctx) {
  await resourceList({
    title: 'المشتريات', endpoint: '/purchases',
    filters: [{ name: 'status', label: 'الحالة', options: Object.entries(L.purchaseStatus).map(([value, label]) => ({ value, label })) }],
    columns: [
      { key: 'orderNumber', label: 'الأمر' }, { key: 'orderDate', label: 'التاريخ', fmt: fmtDateTime }, { key: 'company', label: 'الشركة', fmt: (v) => (v ? v.name : '') },
      { key: 'warehouse', label: 'المخزن', fmt: (v) => (v ? v.name : '') }, { key: 'total', label: 'الإجمالي', num: true, fmt: fmtNum },
      { key: 'status', label: 'الحالة', render: (r) => badge(lbl(L.purchaseStatus, r.status), kind(L.purchaseStatus, r.status)) },
    ],
    onRow: (r) => ctx.navigate('/purchases/' + r.id),
    create: { label: 'أمر شراء جديد', perm: 'purchases.create', open: () => ctx.navigate('/purchases/new') },
  })(ctx);
}

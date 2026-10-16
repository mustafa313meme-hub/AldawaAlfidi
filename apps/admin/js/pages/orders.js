import { badge, fmtDateTime, fmtNum } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { resourceList } from '../resource.js';

export const title = 'الطلبات';

export default async function render(ctx) {
  await resourceList({
    title: 'الطلبات', endpoint: '/orders', query: { customerId: ctx.query.customerId },
    filters: [{ name: 'status', label: 'الحالة', options: Object.entries(L.orderStatus).map(([value, label]) => ({ value, label })) }],
    columns: [
      { key: 'orderNumber', label: 'الطلب' }, { key: 'orderDate', label: 'التاريخ', fmt: fmtDateTime },
      { key: 'customer', label: 'العميل', fmt: (v) => (v ? v.name : '') }, { key: 'total', label: 'الإجمالي', num: true, fmt: fmtNum },
      { key: 'status', label: 'الحالة', render: (r) => badge(lbl(L.orderStatus, r.status), kind(L.orderStatus, r.status)) },
    ],
    onRow: (r) => ctx.navigate('/orders/' + r.id),
  })(ctx);
}

import { badge, fmtDateTime, fmtNum, h } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { resourceList } from '../resource.js';

export const title = 'الفواتير';

export default async function render(ctx) {
  await resourceList({
    title: 'الفواتير', endpoint: '/invoices', query: { customerId: ctx.query.customerId },
    filters: [
      { name: 'status', label: 'الحالة', options: Object.entries(L.invoiceStatus).map(([value, label]) => ({ value, label })) },
      { name: 'paymentStatus', label: 'التسديد', options: Object.entries(L.paymentStatus).map(([value, label]) => ({ value, label })) },
    ],
    columns: [
      { key: 'invoiceNumber', label: 'الفاتورة' }, { key: 'invoiceDate', label: 'التاريخ', fmt: fmtDateTime }, { key: 'customer', label: 'العميل', fmt: (v) => (v ? v.name : '') },
      { key: 'netTotal', label: 'الصافي', num: true, fmt: fmtNum }, { key: 'remainingAmount', label: 'المتبقي', num: true, fmt: fmtNum },
      { key: 'paymentStatus', label: 'التسديد', render: (r) => badge(lbl(L.paymentStatus, r.paymentStatus), kind(L.paymentStatus, r.paymentStatus)) },
      { key: 'status', label: 'الحالة', render: (r) => badge(lbl(L.invoiceStatus, r.status), kind(L.invoiceStatus, r.status)) },
    ],
    onRow: (r) => ctx.navigate('/invoices/' + r.id),
    create: { label: 'فاتورة جديدة', perm: 'invoices.create', open: () => ctx.navigate('/invoices/new') },
  })(ctx);
  void h;
}

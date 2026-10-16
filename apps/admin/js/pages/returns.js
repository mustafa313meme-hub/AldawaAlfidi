import { api } from '../api.js';
import { fmtDateTime, fmtNum, h, modal, table } from '../dom.js';
import { L, lbl } from '../labels.js';
import { resourceList } from '../resource.js';

export const title = 'المردودات';

export default async function render(ctx) {
  await resourceList({
    title: 'المردودات', endpoint: '/returns', query: { customerId: ctx.query.customerId, invoiceId: ctx.query.invoiceId },
    columns: [
      { key: 'returnNumber', label: 'المردود' }, { key: 'returnDate', label: 'التاريخ', fmt: fmtDateTime }, { key: 'invoice', label: 'الفاتورة', fmt: (v) => (v ? v.invoiceNumber : '') },
      { key: 'customer', label: 'العميل', fmt: (v) => (v ? v.name : '') }, { key: 'creditAmount', label: 'القيمة', num: true, fmt: fmtNum }, { key: 'billedAmount', label: 'بونص محاسَب', num: true, fmt: fmtNum },
    ],
    onRow: async (r) => {
      const { data } = await api('GET', `/returns/${r.id}`);
      modal({ title: `المردود ${data.returnNumber}`, wide: true, body: h('div', {}, h('p', { class: 'note' }, `السياسة: ${data.policy}${data.reason ? ' — السبب: ' + data.reason : ''}`),
        table([{ key: 'lineType', label: 'النوع', fmt: (v) => lbl(L.lineType, v) }, { key: 'quantity', label: 'الكمية', num: true }, { key: 'amount', label: 'القيمة', num: true, fmt: fmtNum }, { key: 'condition', label: 'الحالة', fmt: (v) => lbl(L.condition, v) }, { key: 'required', label: 'مطلوب بالسياسة', fmt: (v) => (v ? 'نعم' : '') }], data.items)),
        actions: [{ label: 'إغلاق', kind: 'sec', onClick: (c) => c() }] });
    },
    create: { label: 'مردود جديد', perm: 'returns.create', open: () => ctx.navigate('/returns/new') },
  })(ctx);
}

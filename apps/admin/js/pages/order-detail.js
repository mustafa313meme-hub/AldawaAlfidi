import { api, lookup } from '../api.js';
import { badge, confirmDialog, errorBox, fmtDateTime, fmtNum, h, kv, spinner, table, toast } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { formModal } from '../resource.js';

export const title = 'الطلب';

export default async function render(ctx) {
  const { id } = ctx.params;
  const holder = h('div', {}, spinner());
  ctx.root.append(holder);

  async function act(path, okMsg, body) {
    try { await api('POST', `/orders/${id}/${path}`, { body }); toast(okMsg, 'ok'); await load(); } catch (e) { toast(e.message, 'bad'); }
  }

  async function load() {
    holder.replaceChildren(spinner());
    try {
      const { data: o } = await api('GET', `/orders/${id}`);
      const st = o.status;
      const buttons = [
        st === 'Draft' && ctx.can('orders.create') ? h('button', { class: 'btn', type: 'button', onclick: () => act('submit', 'تم إرسال الطلب') }, 'إرسال') : null,
        st === 'Submitted' && ctx.can('orders.approve') ? h('button', { class: 'btn', type: 'button', onclick: () => act('approve', 'تم اعتماد الطلب') }, 'اعتماد') : null,
        st === 'Approved' && ctx.can('orders.approve') ? h('button', { class: 'btn sec', type: 'button', onclick: () => act('prepare', 'الطلب قيد التجهيز') }, 'قيد التجهيز') : null,
        (st === 'Approved' || st === 'Preparing') && ctx.can('invoices.create') ? h('button', { class: 'btn', type: 'button', onclick: () => formModal({
          title: 'تحويل الطلب إلى فاتورة', saveLabel: 'إنشاء الفاتورة', initial: { warehouseId: o.warehouseId },
          fields: [{ name: 'warehouseId', label: 'المخزن', type: 'select', required: true, load: () => lookup('/warehouses', 'name') }],
          submit: (v) => api('POST', `/orders/${id}/convert-to-invoice`, { body: v }), onDone: (r) => ctx.navigate('/invoices/' + r.data.id) }) }, 'تحويل إلى فاتورة') : null,
        !['Delivered', 'Cancelled'].includes(st) ? h('button', { class: 'btn bad', type: 'button', onclick: async () => { if (await confirmDialog('إلغاء هذا الطلب؟', { danger: true, okLabel: 'إلغاء الطلب' })) act('cancel', 'تم إلغاء الطلب'); } }, 'إلغاء') : null,
        o.invoiceId ? h('a', { class: 'btn sec', href: '#/invoices/' + o.invoiceId }, 'عرض الفاتورة') : null,
      ];
      holder.replaceChildren(
        h('div', { class: 'toolbar' }, h('h2', {}, `الطلب ${o.orderNumber}`), h('div', { class: 'sp' }), buttons),
        h('div', { class: 'card' }, kv([
          ['الحالة', badge(lbl(L.orderStatus, st), kind(L.orderStatus, st))], ['العميل', o.customer && h('a', { href: '#/customers/' + o.customerId }, o.customer.name)], ['التاريخ', fmtDateTime(o.orderDate)],
          ['الإجمالي قبل الخصم', fmtNum(o.subtotal)], ['الخصم', fmtNum(o.discountTotal)], ['الصافي', h('strong', {}, fmtNum(o.total))], ['قيمة البونص (غير مفوتر)', fmtNum(o.bonusValue)], ['ملاحظات', o.notes]])),
        h('h3', {}, 'الأصناف'),
        table([{ render: (r) => r.product.nameAr, label: 'المنتج' }, { key: 'quantity', label: 'الكمية', num: true }, { key: 'bonusQuantity', label: 'بونص', num: true },
          { key: 'unitPrice', label: 'السعر', num: true, fmt: fmtNum }, { key: 'discountAmount', label: 'الخصم', num: true, fmt: fmtNum }, { key: 'lineTotal', label: 'الإجمالي', num: true, fmt: fmtNum }], o.items));
    } catch (e) { holder.replaceChildren(errorBox(e)); }
  }
  await load();
}

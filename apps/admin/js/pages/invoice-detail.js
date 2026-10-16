import { api } from '../api.js';
import { badge, errorBox, fmtDateTime, fmtNum, h, kv, promptDialog, put, spinner, table, toast } from '../dom.js';
import { kind, L, lbl } from '../labels.js';

export const title = 'الفاتورة';

export default async function render(ctx) {
  const { id } = ctx.params;
  const holder = h('div', {}, spinner());
  ctx.root.append(holder);
  async function load() {
    holder.replaceChildren(spinner());
    try {
      const [{ data: inv }, rets] = await Promise.all([api('GET', `/invoices/${id}`), ctx.can('returns.view') ? api('GET', '/returns', { query: { invoiceId: id, pageSize: 50 } }) : null]);
      const confirmed = inv.status === 'Confirmed';
      put(holder,
        h('div', { class: 'toolbar' }, h('h2', {}, `الفاتورة ${inv.invoiceNumber}`), h('div', { class: 'sp' }),
          confirmed && ctx.can('returns.create') ? h('a', { class: 'btn', href: `#/returns/new?invoice=${id}` }, 'إنشاء مردود') : null,
          confirmed && ctx.can('payments.create') && inv.remainingAmount > 0 ? h('a', { class: 'btn sec', href: `#/payments?customerId=${inv.customerId}&invoiceId=${id}` }, 'تسجيل تسديد') : null,
          confirmed && ctx.can('invoices.cancel') ? h('button', { class: 'btn bad', type: 'button', onclick: async () => {
            const reason = await promptDialog('سبب إلغاء الفاتورة');
            if (!reason) return;
            try { await api('POST', `/invoices/${id}/cancel`, { body: { reason } }); toast('أُلغيت الفاتورة', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); }
          } }, 'إلغاء الفاتورة') : null),
        h('div', { class: 'card' }, kv([
          ['الحالة', badge(lbl(L.invoiceStatus, inv.status), kind(L.invoiceStatus, inv.status))], ['العميل', inv.customer && h('a', { href: '#/customers/' + inv.customerId }, inv.customer.name)],
          ['المخزن', inv.warehouse && inv.warehouse.name], ['التاريخ', fmtDateTime(inv.invoiceDate)],
          ['الإجمالي قبل الخصم', fmtNum(inv.subtotal)], ['الخصم', fmtNum(inv.discountTotal)], ['الضريبة', fmtNum(inv.taxTotal)], ['الصافي', h('strong', {}, fmtNum(inv.netTotal))],
          ['المسدّد', fmtNum(inv.paidAmount)], ['المردود', fmtNum(inv.returnedAmount)], ['المتبقي', h('strong', {}, fmtNum(inv.remainingAmount))],
          ['حالة التسديد', badge(lbl(L.paymentStatus, inv.paymentStatus), kind(L.paymentStatus, inv.paymentStatus))], ['قيمة البونص (غير مفوتر)', fmtNum(inv.bonusValue)],
          inv.cancelReason ? ['سبب الإلغاء', inv.cancelReason] : null, ['ملاحظات', inv.notes]])),
        h('h3', {}, 'الأصناف'),
        table([{ label: 'المنتج', render: (r) => r.product.nameAr }, { key: 'quantity', label: 'مباع', num: true }, { key: 'bonusQuantity', label: 'بونص', num: true }, { key: 'unitPrice', label: 'السعر', num: true, fmt: fmtNum },
          { key: 'discountAmount', label: 'الخصم', num: true, fmt: fmtNum }, { key: 'lineTotal', label: 'الإجمالي', num: true, fmt: fmtNum }, { key: 'returnedQuantity', label: 'مرتجع', num: true }, { key: 'bonusReturnedQuantity', label: 'بونص مرتجع', num: true }], inv.items),
        rets ? [h('h3', {}, 'المردودات'), table([{ key: 'returnNumber', label: 'المردود' }, { key: 'returnDate', label: 'التاريخ', fmt: fmtDateTime }, { key: 'creditAmount', label: 'القيمة', num: true, fmt: fmtNum }, { key: 'billedAmount', label: 'بونص محاسَب', num: true, fmt: fmtNum }], rets.data, { empty: 'لا مردودات' })] : null);
    } catch (e) { holder.replaceChildren(errorBox(e)); }
  }
  await load();
}

import { api, lookup } from '../api.js';
import { badge, buildForm, confirmDialog, errorBox, fmtDateTime, fmtNum, h, kv, modal, promptDialog, table, toast } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { picker } from '../picker.js';
import { resourceList } from '../resource.js';

export const title = 'التسديدات';

export default async function render(ctx) {
  function openCreate(reload, presetCustomerId, presetInvoiceId) {
    const err = h('div');
    const invSel = h('select', { 'aria-label': 'الفاتورة' }, h('option', { value: '' }, 'الأقدم أولاً (تلقائي)'));
    let customer = null;
    const loadInvoices = async (c) => {
      customer = c;
      try {
        const { data } = await api('GET', `/customers/${c.id}/open-invoices`);
        invSel.replaceChildren(h('option', { value: '' }, 'الأقدم أولاً (تلقائي)'), ...data.map((i) => h('option', { value: i.id }, `${i.invoiceNumber} — المتبقي ${fmtNum(i.remainingAmount)}`)));
        if (presetInvoiceId) invSel.value = presetInvoiceId;
      } catch { /* no ledger.view: allocation stays automatic */ }
    };
    const pick = picker({ endpoint: '/customers', label: (c) => `${c.code} — ${c.name}`, placeholder: 'ابحث عن العميل', onPick: loadInvoices });
    if (presetCustomerId) api('GET', `/customers/${presetCustomerId}`).then(({ data }) => pick.set(data)).catch(() => {});
    const form = buildForm([
      { name: 'amount', label: 'المبلغ', type: 'number', min: 1, required: true },
      { name: 'method', label: 'طريقة الدفع', type: 'select', required: true, options: Object.entries(L.payMethod).map(([value, label]) => ({ value, label })) },
      { name: 'referenceNumber', label: 'رقم المرجع (حوالة/صك)' }, { name: 'notes', label: 'ملاحظات', full: true },
      { name: 'autoAllocate', label: 'وزّع الباقي على الفواتير الأقدم', type: 'checkbox', default: true },
    ], { method: 'Cash' });
    modal({
      title: 'تسجيل تسديد', wide: true, body: h('div', {}, err, h('label', { class: 'f' }, 'العميل', pick.el), h('br'), h('label', { class: 'f' }, 'الفاتورة', invSel), h('br'), form.el),
      actions: [{ label: 'تسجيل', onClick: async (close, btn) => {
        err.replaceChildren();
        if (!customer) { err.replaceChildren(errorBox({ message: 'اختر العميل' })); return; }
        if (!form.validate()) return;
        btn.disabled = true;
        try {
          const { data } = await api('POST', '/payments', { body: { ...form.values(), customerId: customer.id, invoiceId: invSel.value || undefined } });
          close();
          modal({ title: `تم تسجيل التسديد ${data.paymentNumber}`, body: h('div', {}, h('p', {}, `المبلغ ${fmtNum(data.amount)} — موزَّع ${fmtNum(data.allocatedAmount)}${data.amount > data.allocatedAmount ? ` — رصيد دائن على الحساب ${fmtNum(data.amount - data.allocatedAmount)}` : ''}`),
            table([{ label: 'الفاتورة', render: (a) => a.invoice.invoiceNumber }, { key: 'amount', label: 'المبلغ', num: true, fmt: fmtNum }], data.allocations, { empty: 'لم يُوزَّع على فاتورة' })), actions: [{ label: 'إغلاق', kind: 'sec', onClick: (c) => c() }] });
          reload();
        } catch (e) { err.replaceChildren(errorBox(e)); btn.disabled = false; }
      } }, { label: 'إلغاء', kind: 'sec', onClick: (c) => c() }],
    });
  }

  await resourceList({
    title: 'التسديدات', endpoint: '/payments', query: { customerId: ctx.query.customerId },
    filters: [
      { name: 'status', label: 'الحالة', options: Object.entries(L.payDoc).map(([value, label]) => ({ value, label })) },
      { name: 'method', label: 'الطريقة', options: Object.entries(L.payMethod).map(([value, label]) => ({ value, label })) },
    ],
    columns: [
      { key: 'paymentNumber', label: 'التسديد' }, { key: 'paymentDate', label: 'التاريخ', fmt: fmtDateTime }, { key: 'customer', label: 'العميل', fmt: (v) => (v ? v.name : '') },
      { key: 'amount', label: 'المبلغ', num: true, fmt: fmtNum }, { key: 'allocatedAmount', label: 'الموزَّع', num: true, fmt: fmtNum }, { key: 'method', label: 'الطريقة', fmt: (v) => lbl(L.payMethod, v) },
      { key: 'status', label: 'الحالة', render: (r) => badge(lbl(L.payDoc, r.status), kind(L.payDoc, r.status)) },
    ],
    onRow: async (r, reload) => {
      const { data: p } = await api('GET', `/payments/${r.id}`);
      modal({ title: `التسديد ${p.paymentNumber}`, wide: true,
        body: h('div', {}, kv([['العميل', p.customer.name], ['المبلغ', fmtNum(p.amount)], ['الموزَّع', fmtNum(p.allocatedAmount)], ['الطريقة', lbl(L.payMethod, p.method)], ['المرجع', p.referenceNumber], ['ملاحظات', p.notes], p.cancelReason ? ['سبب الإلغاء', p.cancelReason] : null]),
          h('h3', {}, 'التوزيع'), table([{ label: 'الفاتورة', render: (a) => a.invoice.invoiceNumber }, { key: 'amount', label: 'المبلغ', num: true, fmt: fmtNum }], p.allocations, { empty: 'غير موزَّع' })),
        actions: [
          p.status === 'Confirmed' && ctx.can('payments.cancel') ? { label: 'إلغاء التسديد', kind: 'bad', onClick: async (close) => {
            const reason = await promptDialog('سبب إلغاء التسديد');
            if (!reason) return;
            try { await api('POST', `/payments/${r.id}/cancel`, { body: { reason } }); close(); toast('أُلغي التسديد', 'ok'); reload(); } catch (e) { toast(e.message, 'bad'); }
          } } : null,
          { label: 'إغلاق', kind: 'sec', onClick: (c) => c() }].filter(Boolean) });
    },
    create: { label: 'تسجيل تسديد', perm: 'payments.create', open: (reload) => openCreate(reload) },
  })(ctx);
  void lookup; void confirmDialog;
  if (ctx.query.customerId && ctx.can('payments.create')) openCreate(() => ctx.navigate('/payments'), ctx.query.customerId, ctx.query.invoiceId);
}

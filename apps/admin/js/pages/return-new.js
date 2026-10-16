import { api } from '../api.js';
import { badge, errorBox, fmtDate, fmtNum, h, modal, promptDialog, put, spinner, table, toast } from '../dom.js';
import { creditForReturn, requiredBonus } from '../logic.js';
import { L, lbl } from '../labels.js';
import { picker } from '../picker.js';

export const title = 'مردود جديد';

export default async function render(ctx) {
  const root = ctx.root;
  const err = h('div');
  const body = h('div');
  root.append(h('h2', {}, 'مردود جديد'), err, body);

  // the preview needs the policy; without settings.view we assume the approved default and say it is an estimate
  let policy = 'Proportional';
  try { const { data } = await api('GET', '/settings'); policy = data.bonus_return_policy || policy; } catch { /* keep default */ }

  if (ctx.query.invoice) return showInvoice(ctx.query.invoice);

  const invSel = h('select', { 'aria-label': 'الفاتورة' });
  const go = h('button', { class: 'btn', type: 'button', onclick: () => invSel.value && showInvoice(invSel.value) }, 'متابعة');
  const loadInvoices = async (c) => {
    try {
      const { data } = await api('GET', '/invoices', { query: { customerId: c.id, status: 'Confirmed', pageSize: 100 } });
      invSel.replaceChildren(h('option', { value: '' }, data.length ? 'اختر الفاتورة' : 'لا فواتير'), ...data.map((i) => h('option', { value: i.id }, `${i.invoiceNumber} — ${fmtDate(i.invoiceDate)} — ${fmtNum(i.netTotal)}`)));
    } catch (e) { err.replaceChildren(errorBox(e)); }
  };
  const cust = picker({ endpoint: '/customers', label: (c) => `${c.code} — ${c.name}`, placeholder: 'ابحث عن العميل', onPick: loadInvoices });
  body.append(h('div', { class: 'card' }, h('label', { class: 'f' }, 'العميل', cust.el), h('br'), h('label', { class: 'f' }, 'الفاتورة', invSel), h('br'), go));

  async function showInvoice(invoiceId) {
    body.replaceChildren(spinner());
    try {
      const { data: inv } = await api('GET', `/invoices/${invoiceId}`);
      if (inv.status !== 'Confirmed') { body.replaceChildren(errorBox({ message: 'الفاتورة ملغاة' })); return; }
      const rows = inv.items.map((it) => ({
        it, tiers: Array.isArray(it.bonusRuleSnapshot) ? it.bonusRuleSnapshot : [],
        soldReturnable: it.quantity - it.returnedQuantity, bonusHeld: it.bonusQuantity - it.bonusReturnedQuantity,
        sold: h('input', { type: 'number', min: 0, max: it.quantity - it.returnedQuantity, value: 0, 'aria-label': 'كمية مباعة مرتجعة' }),
        bonus: h('input', { type: 'number', min: 0, max: it.bonusQuantity - it.bonusReturnedQuantity, value: 0, 'aria-label': 'بونص مرتجع' }),
        cond: h('select', { 'aria-label': 'الحالة' }, Object.entries(L.condition).map(([v, l]) => h('option', { value: v }, l))),
        info: h('div', { class: 'note' }),
      }));
      const refresh = () => rows.forEach((r) => {
        const q = Math.max(0, Math.min(Number(r.sold.value) || 0, r.soldReturnable));
        const need = requiredBonus(policy, { quantity: r.it.quantity, bonusQuantity: r.it.bonusQuantity, returnedQuantity: r.it.returnedQuantity, bonusReturnedQuantity: r.it.bonusReturnedQuantity, tiers: r.tiers }, q);
        const credit = q > 0 ? creditForReturn(r.it.lineTotal, r.it.quantity, r.it.returnedQuantity, q) : 0;
        r.info.textContent = q > 0 || Number(r.bonus.value) > 0 ? `تقدير: قيمة المردود ${fmtNum(credit)}${need > 0 ? ` — البونص المطلوب إرجاعه حسب السياسة: ${need}` : ''}` : '';
      });
      rows.forEach((r) => { r.sold.addEventListener('input', refresh); r.bonus.addEventListener('input', refresh); });
      const billed = h('input', { type: 'checkbox' });
      const reason = h('input', { 'aria-label': 'سبب المردود', placeholder: 'سبب المردود (اختياري)' });
      const save = h('button', { class: 'btn', type: 'button', onclick: async () => {
        err.replaceChildren();
        const items = rows.map((r) => ({ invoiceItemId: r.it.id, soldQuantity: Number(r.sold.value) || 0, bonusQuantity: Number(r.bonus.value) || 0, condition: r.cond.value }))
          .filter((i) => i.soldQuantity > 0 || i.bonusQuantity > 0);
        if (!items.length) { err.replaceChildren(errorBox({ message: 'أدخل كمية مرتجعة لصنف واحد على الأقل' })); return; }
        save.disabled = true;
        try {
          const { data } = await api('POST', '/returns', { body: { invoiceId, items, reason: reason.value.trim() || undefined, billExcessBonus: billed.checked || undefined } });
          modal({ title: `تم إنشاء المردود ${data.returnNumber}`, wide: true, body: h('div', {}, h('p', {}, `قيمة المردود: ${fmtNum(data.creditAmount)}${data.billedAmount ? ` — بونص محاسَب عليه: ${fmtNum(data.billedAmount)}` : ''}`),
            table([{ key: 'lineType', label: 'النوع', fmt: (v) => lbl(L.lineType, v) }, { key: 'quantity', label: 'الكمية', num: true }, { key: 'amount', label: 'القيمة', num: true, fmt: fmtNum }, { key: 'required', label: 'مطلوب بالسياسة', fmt: (v) => (v ? 'نعم' : '') }], data.items)),
            actions: [{ label: 'عرض الفاتورة', onClick: (c) => { c(); ctx.navigate('/invoices/' + invoiceId); } }] });
          toast('تم', 'ok');
        } catch (e) { err.replaceChildren(errorBox(e)); save.disabled = false; }
      } }, 'تسجيل المردود');
      put(body,
        h('div', { class: 'card' }, h('strong', {}, `الفاتورة ${inv.invoiceNumber}`), ' — ', inv.customer.name, ' ', badge('سياسة البونص: ' + policy)),
        h('p', { class: 'note' }, 'التقدير أدناه للمساعدة فقط؛ الخادم هو الذي يحسب ويفرض القواعد، وقد يضيف البونص المطلوب إرجاعه تلقائياً.'),
        h('div', { class: 'tbl-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['المنتج', 'مباع', 'مرتجع سابقاً', 'القابل للإرجاع', 'بونص بحوزة العميل', 'كمية مباعة مرتجعة', 'بونص مرتجع', 'الحالة'].map((x) => h('th', {}, x)))),
          h('tbody', {}, rows.map((r) => [h('tr', {}, h('td', {}, r.it.product.nameAr), h('td', { class: 'num' }, r.it.quantity), h('td', { class: 'num' }, r.it.returnedQuantity), h('td', { class: 'num' }, r.soldReturnable), h('td', { class: 'num' }, r.bonusHeld), h('td', {}, r.sold), h('td', {}, r.bonus), h('td', {}, r.cond)),
            // the estimate sits in its own visible row under the item (it used to be a last column that scrolled out of sight)
            h('tr', { class: 'est-row' }, h('td', { colspan: 8, class: 'est' }, r.info))])))),
        ctx.can('returns.approve') ? h('label', { class: 'f chk' }, billed, 'محاسبة البونص الزائد على العميل بدل إرجاعه (يتطلب صلاحية الاعتماد)') : null,
        h('div', { class: 'toolbar' }, h('label', { class: 'f' }, 'السبب', reason), save));
    } catch (e) { body.replaceChildren(errorBox(e)); }
  }
  void promptDialog;
}

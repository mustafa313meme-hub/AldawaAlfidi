import { api } from '../api.js';
import { badge, confirmDialog, errorBox, fmtDate, fmtDateTime, fmtNum, h, kv, modal, spinner, table, toast } from '../dom.js';
import { kind, L, lbl } from '../labels.js';

export const title = 'أمر الشراء';

export default async function render(ctx) {
  const { id } = ctx.params;
  const holder = h('div', {}, spinner());
  ctx.root.append(holder);
  const act = async (path, msg) => { try { await api('POST', `/purchases/${id}/${path}`); toast(msg, 'ok'); load(); } catch (e) { toast(e.message, 'bad'); } };

  function openReceive(po) {
    // one batch row per item by default (full quantity); "add batch" splits an item across batches. Sums must match the order.
    const lines = [];
    const body = h('div', {}, h('p', { class: 'note' }, 'مجموع كميات التشغيلات لكل صنف يجب أن يساوي المطلوب (والبونص). تاريخ الانتهاء لا يكون في الماضي.'));
    const err = h('div');
    const addRow = (item, container, qty, bonus) => {
      const r = { item, batch: h('input', { 'aria-label': 'رقم التشغيلة', placeholder: 'رقم التشغيلة' }), exp: h('input', { type: 'date', 'aria-label': 'تاريخ الانتهاء' }), qty: h('input', { type: 'number', min: 0, value: qty, 'aria-label': 'الكمية' }), bonus: h('input', { type: 'number', min: 0, value: bonus, 'aria-label': 'البونص' }) };
      lines.push(r);
      container.append(h('div', { class: 'form' }, h('label', { class: 'f' }, 'رقم التشغيلة', r.batch), h('label', { class: 'f' }, 'الانتهاء', r.exp), h('label', { class: 'f' }, 'الكمية', r.qty), h('label', { class: 'f' }, 'بونص', r.bonus)));
    };
    for (const it of po.items) {
      const box = h('div', { class: 'card' }, h('strong', {}, it.product.nameAr), h('span', { class: 'note' }, `  مطلوب: ${it.quantity} + بونص ${it.bonusQuantity}`));
      addRow(it, box, it.quantity, it.bonusQuantity);
      box.append(h('button', { class: 'btn sec sm', type: 'button', onclick: () => addRow(it, box, 0, 0) }, 'إضافة تشغيلة'));
      body.append(box);
    }
    modal({ title: 'استلام البضاعة', wide: true, body: h('div', {}, err, body), actions: [
      { label: 'تأكيد الاستلام', onClick: async (close, btn) => {
        err.replaceChildren();
        const payload = lines.filter((r) => Number(r.qty.value) > 0 || Number(r.bonus.value) > 0).map((r) => ({ itemId: r.item.id, batchNumber: r.batch.value.trim(), expiryDate: r.exp.value || undefined, quantity: Number(r.qty.value) || 0, bonusQuantity: Number(r.bonus.value) || 0 }));
        if (payload.some((l) => !l.batchNumber)) { err.replaceChildren(errorBox({ message: 'رقم التشغيلة مطلوب لكل سطر' })); return; }
        btn.disabled = true;
        try { await api('POST', `/purchases/${id}/receive`, { body: { lines: payload } }); close(); toast('تم الاستلام وتحديث المخزون', 'ok'); load(); } catch (e) { err.replaceChildren(errorBox(e)); btn.disabled = false; }
      } }, { label: 'إلغاء', kind: 'sec', onClick: (c) => c() }] });
  }

  async function load() {
    holder.replaceChildren(spinner());
    try {
      const { data: po } = await api('GET', `/purchases/${id}`);
      const open = po.status === 'Draft' || po.status === 'Ordered';
      holder.replaceChildren(
        h('div', { class: 'toolbar' }, h('h2', {}, `أمر الشراء ${po.orderNumber}`), h('div', { class: 'sp' }),
          po.status === 'Draft' && ctx.can('purchases.create') ? h('button', { class: 'btn sec', type: 'button', onclick: () => act('order', 'تم تحويل الأمر إلى «مطلوب»') }, 'اعتماد الطلب') : null,
          open && ctx.can('purchases.receive') ? h('button', { class: 'btn', type: 'button', onclick: () => openReceive(po) }, 'استلام') : null,
          open && ctx.can('purchases.cancel') ? h('button', { class: 'btn bad', type: 'button', onclick: async () => { if (await confirmDialog('إلغاء أمر الشراء؟', { danger: true })) act('cancel', 'أُلغي الأمر'); } }, 'إلغاء') : null),
        h('div', { class: 'card' }, kv([['الحالة', badge(lbl(L.purchaseStatus, po.status), kind(L.purchaseStatus, po.status))], ['الشركة', po.company.name], ['المخزن', po.warehouse.name], ['التاريخ', fmtDateTime(po.orderDate)],
          ['الإجمالي', h('strong', {}, fmtNum(po.total))], ['الخصم', fmtNum(po.discountTotal)], po.receivedAt ? ['استُلم في', fmtDate(po.receivedAt)] : null, ['ملاحظات', po.notes]])),
        h('h3', {}, 'الأصناف'),
        table([{ label: 'المنتج', render: (r) => r.product.nameAr }, { key: 'quantity', label: 'الكمية', num: true }, { key: 'bonusQuantity', label: 'بونص', num: true }, { key: 'unitCost', label: 'تكلفة الوحدة', num: true, fmt: fmtNum }, { key: 'discountAmount', label: 'الخصم', num: true, fmt: fmtNum }, { key: 'lineTotal', label: 'الإجمالي', num: true, fmt: fmtNum }], po.items));
    } catch (e) { holder.replaceChildren(errorBox(e)); }
  }
  await load();
}

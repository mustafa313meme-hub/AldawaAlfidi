// Stock operations: transfers between warehouses and adjustments (damage/expiry/correction/loss).
import { api, lookup } from '../api.js';
import { buildForm, errorBox, fmtDateTime, fmtNum, h, modal, table, toast } from '../dom.js';
import { L, lbl } from '../labels.js';
import { linesEditor } from '../lines.js';
import { resourceList } from '../resource.js';

function opPage({ title, endpoint, columns, perm, kind, fields, body, newLabel, detail }) {
  return async function render(ctx) {
    await resourceList({
      title, endpoint, columns,
      onRow: async (r) => { const { data } = await api('GET', `${endpoint}/${r.id}`); modal({ title: detail(data), wide: true, body: table([{ label: 'المنتج', render: (i) => i.productId }, { key: 'batchNumber', label: 'التشغيلة' }, { key: kind === 'qty' ? 'quantity' : 'quantityDelta', label: 'الكمية', num: true, fmt: fmtNum }], data.items), actions: [{ label: 'إغلاق', kind: 'sec', onClick: (c) => c() }] }); },
      create: { label: newLabel, perm, open: (reload) => {
        const form = buildForm(fields);
        const lines = linesEditor({ kind });
        const err = h('div');
        const m = modal({ title: newLabel, wide: true, body: h('div', {}, err, form.el, h('h3', {}, 'الأصناف'), lines.el, kind === 'delta' ? h('p', { class: 'note' }, 'الإنقاص من الأقرب انتهاءً أولاً (للتالف/المنتهي يُسمح بسحب التشغيلات المنتهية).') : null),
          actions: [{ label: 'تنفيذ', onClick: async (close, btn) => {
            err.replaceChildren();
            if (!form.validate()) return;
            const bad = lines.validate();
            if (bad) { err.replaceChildren(errorBox({ message: bad })); return; }
            btn.disabled = true;
            try { await api('POST', endpoint, { body: body(form.values(), lines.getLines()) }); close(); toast('تم التنفيذ', 'ok'); reload(); } catch (e) { err.replaceChildren(errorBox(e)); btn.disabled = false; }
          } }, { label: 'إلغاء', kind: 'sec', onClick: (c) => c() }] });
        return m;
      } },
    })(ctx);
  };
}

const wh = () => lookup('/warehouses', 'name');

export const transfers = opPage({
  title: 'التحويل بين المخازن', endpoint: '/transfers', perm: 'inventory.transfer', kind: 'qty', newLabel: 'تحويل جديد',
  columns: [{ key: 'transferNumber', label: 'التحويل' }, { key: 'createdAt', label: 'التاريخ', fmt: fmtDateTime }, { key: 'fromWarehouse', label: 'من', fmt: (v) => (v ? v.name : '') }, { key: 'toWarehouse', label: 'إلى', fmt: (v) => (v ? v.name : '') }],
  fields: [{ name: 'fromWarehouseId', label: 'من مخزن', type: 'select', required: true, load: wh }, { name: 'toWarehouseId', label: 'إلى مخزن', type: 'select', required: true, load: wh }, { name: 'notes', label: 'ملاحظات', full: true }],
  body: (v, items) => ({ ...v, items }), detail: (d) => `التحويل ${d.transferNumber}`,
});

export const adjustments = opPage({
  title: 'تسويات المخزون', endpoint: '/adjustments', perm: 'inventory.adjust', kind: 'delta', newLabel: 'تسوية جديدة',
  columns: [{ key: 'adjustmentNumber', label: 'التسوية' }, { key: 'createdAt', label: 'التاريخ', fmt: fmtDateTime }, { key: 'reason', label: 'السبب', fmt: (v) => lbl(L.adjReason, v) }, { key: 'notes', label: 'ملاحظات' }],
  fields: [{ name: 'warehouseId', label: 'المخزن', type: 'select', required: true, load: wh }, { name: 'reason', label: 'السبب', type: 'select', required: true, options: Object.entries(L.adjReason).map(([value, label]) => ({ value, label })) }, { name: 'notes', label: 'ملاحظات', full: true }],
  body: (v, items) => ({ ...v, items }), detail: (d) => `التسوية ${d.adjustmentNumber}`,
});

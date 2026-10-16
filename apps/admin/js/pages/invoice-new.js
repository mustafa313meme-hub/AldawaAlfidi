import { api, lookup } from '../api.js';
import { buildForm, errorBox, h, toast } from '../dom.js';
import { linesEditor } from '../lines.js';
import { picker } from '../picker.js';

export const title = 'فاتورة جديدة';

export default async function render(ctx) {
  const customer = picker({ endpoint: '/customers', query: { status: 'Active' }, label: (c) => `${c.code} — ${c.name}`, placeholder: 'ابحث عن العميل (اسم/هاتف/كود)' });
  const form = buildForm([{ name: 'warehouseId', label: 'المخزن', type: 'select', required: true, load: () => lookup('/warehouses', 'name') }, { name: 'notes', label: 'ملاحظات', full: true }]);
  const lines = linesEditor({ kind: 'sale' });
  const err = h('div');
  const note = h('p', { class: 'note' }, 'السعر والبونص والضريبة تُحسب في الخادم حسب قائمة أسعار العميل. الخصم يتطلب صلاحية. التشغيلة تُختار تلقائياً (الأقرب انتهاءً).');
  let key = crypto.randomUUID(); // reused if the request is retried, so a double click or a lost response cannot create two invoices
  const save = h('button', { class: 'btn', type: 'button', onclick: async () => {
    err.replaceChildren();
    if (!customer.value) { err.replaceChildren(errorBox({ message: 'اختر العميل' })); return; }
    if (!form.validate()) return;
    const bad = lines.validate();
    if (bad) { err.replaceChildren(errorBox({ message: bad })); return; }
    save.disabled = true;
    try {
      const v = form.values();
      const { data } = await api('POST', '/invoices', { body: { customerId: customer.value.id, warehouseId: v.warehouseId, notes: v.notes, lines: lines.getLines() }, headers: { 'idempotency-key': key } });
      key = crypto.randomUUID();
      toast('أُنشئت الفاتورة ' + data.invoiceNumber, 'ok');
      ctx.navigate('/invoices/' + data.id);
    } catch (e) { err.replaceChildren(errorBox(e)); save.disabled = false; }
  } }, 'إنشاء الفاتورة');
  ctx.root.append(h('h2', {}, 'فاتورة جديدة'), err, h('div', { class: 'card' }, h('label', { class: 'f' }, 'العميل', customer.el), h('br'), form.el), h('div', { class: 'card' }, h('h3', {}, 'الأصناف'), lines.el, note), save);
}

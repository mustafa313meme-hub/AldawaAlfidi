import { api, lookup } from '../api.js';
import { buildForm, errorBox, h, toast } from '../dom.js';
import { linesEditor } from '../lines.js';

export const title = 'أمر شراء جديد';

export default async function render(ctx) {
  const err = h('div');
  const linesBox = h('div', {}, h('p', { class: 'note' }, 'اختر الشركة أولاً لإضافة أصنافها.'));
  let lines = null;
  const form = buildForm([
    { name: 'companyId', label: 'الشركة (المورّد)', type: 'select', required: true, load: () => lookup('/companies', 'name') },
    { name: 'warehouseId', label: 'مخزن الاستلام', type: 'select', required: true, load: () => lookup('/warehouses', 'name') },
    { name: 'notes', label: 'ملاحظات', full: true },
  ]);
  form.inputs.companyId.addEventListener('change', () => {
    const c = form.inputs.companyId.value;
    lines = c ? linesEditor({ kind: 'purchase', productQuery: { companyId: c } }) : null;
    linesBox.replaceChildren(lines ? lines.el : h('p', { class: 'note' }, 'اختر الشركة أولاً لإضافة أصنافها.'));
  });
  const save = h('button', { class: 'btn', type: 'button', onclick: async () => {
    err.replaceChildren();
    if (!form.validate()) return;
    const bad = lines ? lines.validate() : 'أضف أصنافاً';
    if (bad) { err.replaceChildren(errorBox({ message: bad })); return; }
    save.disabled = true;
    try {
      const { data } = await api('POST', '/purchases', { body: { ...form.values(), items: lines.getLines() } });
      toast('أُنشئ أمر الشراء ' + data.orderNumber, 'ok');
      ctx.navigate('/purchases/' + data.id);
    } catch (e) { err.replaceChildren(errorBox(e)); save.disabled = false; }
  } }, 'حفظ كمسودة');
  ctx.root.append(h('h2', {}, 'أمر شراء جديد'), err, h('div', { class: 'card' }, form.el), h('div', { class: 'card' }, h('h3', {}, 'الأصناف'), linesBox), save);
}

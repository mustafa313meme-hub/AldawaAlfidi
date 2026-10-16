// Daily visit plan per representative: pick customers (only the rep's assigned ones), order them, set priority, save the whole day at once.
import { api, lookup } from '../api.js';
import { UserError, badge, confirmDialog, errorBox, errText, fmtDate, h, put, spinner, todayLocal, toast } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { picker } from '../picker.js';

export const title = 'خطط الزيارة';

export default async function render(ctx) {
  const manage = ctx.can('visit_plans.manage');
  const reps = manage ? await lookup('/representatives', (r) => `${r.employeeCode} — ${r.fullName}`).catch(() => []) : [];
  const repSel = h('select', { 'aria-label': 'المندوب' }, h('option', { value: '' }, '— اختر المندوب —'), reps.map((r) => h('option', { value: r.value }, r.label)));
  const dateIn = h('input', { type: 'date', value: ctx.query.date || todayLocal(), 'aria-label': 'التاريخ' });
  const body = h('div');
  let items = []; // {customer, priority, status, id?, lastVisitDate}
  let dirty = false;

  const header = h('div', { class: 'toolbar' },
    manage ? h('label', { class: 'f' }, 'المندوب', repSel) : null, h('label', { class: 'f' }, 'التاريخ', dateIn),
    h('button', { class: 'btn sec', type: 'button', onclick: () => load() }, 'عرض'));
  ctx.root.append(h('h2', {}, 'خطط الزيارة'), header, body);

  let lastRep = repSel.value, lastDate = dateIn.value;
  const changed = async () => {
    if (dirty && !(await confirmDialog('لديك تغييرات غير محفوظة. متابعة بدون حفظ؟', { danger: true, okLabel: 'متابعة بدون حفظ' }))) { repSel.value = lastRep; dateIn.value = lastDate; return; }
    lastRep = repSel.value; lastDate = dateIn.value;
    load();
  };
  repSel.addEventListener('change', changed);
  dateIn.addEventListener('change', changed);

  async function load() {
    dirty = false;
    if (manage && !repSel.value) { body.replaceChildren(h('p', { class: 'note' }, 'اختر مندوباً لعرض خطته.')); return; }
    if (!dateIn.value) return;
    body.replaceChildren(spinner());
    try {
      const { data } = await api('GET', '/visit-plans', { query: { date: dateIn.value, representativeId: manage ? repSel.value : undefined } });
      items = data.map((p) => ({ id: p.id, customer: p.customer, priority: p.priority, status: p.status, lastVisitDate: p.lastVisitDate }));
      draw();
    } catch (e) { body.replaceChildren(errorBox(e)); }
  }

  function draw() {
    const err = h('div');
    const rows = items.map((it, i) => {
      const done = it.status === 'Done';
      return h('tr', {},
        h('td', { class: 'num' }, i + 1), h('td', {}, `${it.customer.code} — ${it.customer.name}`), h('td', {}, it.customer.address || ''),
        h('td', {}, it.lastVisitDate ? fmtDate(it.lastVisitDate) : 'لم يُزَر'),
        h('td', {}, badge(lbl(L.planStatus, it.status), kind(L.planStatus, it.status))),
        manage ? h('td', {}, done ? String(it.priority) : h('input', { type: 'number', min: 0, max: 10, value: it.priority, 'aria-label': 'الأولوية', oninput: (e) => { it.priority = Number(e.target.value); dirty = true; } })) : h('td', {}, String(it.priority)),
        manage ? h('td', {}, done ? '' : [
          h('button', { class: 'btn sec sm', type: 'button', disabled: i === 0 || items[i - 1].status === 'Done', 'aria-label': 'للأعلى', onclick: () => { [items[i - 1], items[i]] = [items[i], items[i - 1]]; dirty = true; draw(); } }, '▲'), ' ',
          h('button', { class: 'btn sec sm', type: 'button', disabled: i === items.length - 1, 'aria-label': 'للأسفل', onclick: () => { [items[i + 1], items[i]] = [items[i], items[i + 1]]; dirty = true; draw(); } }, '▼'), ' ',
          h('button', { class: 'btn sec sm', type: 'button', onclick: () => { items.splice(i, 1); dirty = true; draw(); } }, 'حذف')]) : null);
    });
    const pk = manage ? picker({ endpoint: '/customers', query: { representativeId: repSel.value, status: 'Active' }, label: (c) => `${c.code} — ${c.name}`, placeholder: 'ابحث عن عميل من عملاء المندوب لإضافته', onPick: (c) => {
      if (items.some((x) => x.customer.id === c.id)) { toast('العميل موجود في الخطة', 'bad'); return; }
      items.push({ customer: c, priority: 0, status: 'Planned', lastVisitDate: null }); dirty = true; draw();
    } }) : null;
    const hasSkipped = items.some((x) => x.status === 'Skipped' || x.status === 'Cancelled');
    put(body,
      manage ? h('div', { class: 'card' }, h('label', { class: 'f' }, 'إضافة عميل', pk.el)) : null,
      h('div', { class: 'tbl-wrap' }, items.length ? h('table', {}, h('thead', {}, h('tr', {}, ['#', 'العميل', 'العنوان', 'آخر زيارة', 'الحالة', 'الأولوية', ...(manage ? [''] : [])].map((t) => h('th', {}, t)))), h('tbody', {}, rows)) : h('div', { class: 'empty' }, 'لا خطة لهذا اليوم')),
      hasSkipped ? h('p', { class: 'note' }, 'العناصر المتخطّاة/الملغاة تعود «مخطَّطة» عند حفظ الخطة؛ احذفها من القائمة إن لم تُرِدها.') : null,
      err,
      manage ? h('div', { class: 'toolbar' }, h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        err.replaceChildren();
        const btn = e.currentTarget;
        btn.disabled = true;
        try {
          const open = items.filter((x) => x.status !== 'Done');
          if (open.some((x) => !Number.isInteger(x.priority) || x.priority < 0 || x.priority > 10)) throw new UserError('الأولوية عدد صحيح من 0 إلى 10');
          const r = await api('PUT', '/visit-plans/day', { body: { representativeId: repSel.value, date: dateIn.value, items: open.map((x) => ({ customerId: x.customer.id, priority: x.priority })) } });
          toast(`حُفظت الخطة: ${r.data.planned} زيارة مخطَّطة${r.data.keptDone ? ` (+${r.data.keptDone} منجزة)` : ''}`, 'ok');
          await load();
        } catch (ex) { err.replaceChildren(errorBox(ex)); btn.disabled = false; }
      } }, 'حفظ الخطة'), h('span', { class: 'note' }, 'الزيارات المنجزة تبقى كما هي. الحفظ يستبدل الخطة المفتوحة لليوم كلها.')) : null);
  }
  await load();
}
void errText;

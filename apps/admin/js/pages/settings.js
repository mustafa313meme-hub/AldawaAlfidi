import { api } from '../api.js';
import { buildForm, errorBox, h, spinner, toast } from '../dom.js';

export const title = 'الإعدادات';

const FIELDS = [
  { name: 'bonus_return_policy', label: 'سياسة مردود البونص', type: 'select', options: [{ value: 'Proportional', label: 'متناسبة (Proportional)' }, { value: 'Independent', label: 'مستقلة (Independent)' }, { value: 'FullBonusOnReturn', label: 'استرجاع كامل البونص (FullBonusOnReturn)' }] },
  { name: 'require_location_for_visit', label: 'الموقع إلزامي لتسجيل الزيارة', type: 'checkbox' },
  { name: 'visit_block_when_far', label: 'رفض الزيارة البعيدة عن العميل', type: 'checkbox' },
  { name: 'visit_max_accuracy_m', label: 'أقصى خطأ للموقع (متر)', type: 'number', min: 5, max: 1000 },
  { name: 'visit_max_distance_m', label: 'أقصى مسافة عن العميل (متر)', type: 'number', min: 10, max: 5000 },
  { name: 'overdue_days', label: 'أيام التأخر في السداد', type: 'number', min: 1, max: 365 },
  { name: 'currency', label: 'العملة (3 أحرف)' },
  { name: 'app_versions', label: 'إصدارات التطبيق (JSON)', type: 'textarea', full: true, placeholder: '{"android":{"latest":"1.2.0","minSupported":"1.0.0","url":"https://..."}}' },
];

export default async function render(ctx) {
  const holder = h('div', {}, spinner());
  ctx.root.append(h('h2', {}, 'الإعدادات'), holder);
  try {
    const { data } = await api('GET', '/settings');
    const init = { ...data, app_versions: data.app_versions ? JSON.stringify(data.app_versions, null, 2) : '' };
    const form = buildForm(FIELDS, init);
    const canEdit = ctx.can('settings.update');
    if (!canEdit) Object.values(form.inputs).forEach((i) => { i.disabled = true; });
    const err = h('div');
    const save = h('button', { class: 'btn', type: 'button', disabled: !canEdit, onclick: async () => {
      err.replaceChildren();
      const v = form.values();
      const changes = [];
      for (const f of FIELDS) {
        let nv = v[f.name];
        if (f.name === 'app_versions') { if (nv === undefined) continue; try { nv = JSON.parse(nv); } catch { err.replaceChildren(errorBox({ message: 'JSON غير صالح في إصدارات التطبيق' })); return; } if (JSON.stringify(nv) === JSON.stringify(data.app_versions)) continue; }
        else if (nv === undefined || JSON.stringify(nv) === JSON.stringify(data[f.name])) continue;
        changes.push([f.name, nv]);
      }
      if (!changes.length) { toast('لا تغييرات'); return; }
      save.disabled = true;
      try { for (const [k, val] of changes) await api('PUT', `/settings/${k}`, { body: { value: val } }); toast(`حُفظ ${changes.length} إعداد`, 'ok'); } catch (e) { err.replaceChildren(errorBox(e)); }
      save.disabled = false;
    } }, 'حفظ');
    holder.replaceChildren(err, h('div', { class: 'card' }, form.el), save, h('p', { class: 'note' }, 'تغيير حدّ الإصدار الأدنى يسري خلال دقيقة. كل تغيير يُسجَّل في سجل التدقيق.'));
  } catch (e) { holder.replaceChildren(errorBox(e)); }
}

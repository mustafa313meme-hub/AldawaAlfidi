import { api, APP_VERSION, deviceId } from '../api.js';
import { dbCount, wipe } from '../db.js';
import { UserError, confirmDialog, errorBox, errText, field, fmtDateTime, h, kv, toast } from '../dom.js';
import { getMe } from '../session.js';
import { syncNow, syncState } from '../sync.js';

export const title = 'المزيد';

export default async function render(ctx) {
  const me = getMe();
  const s = syncState();
  const counts = await Promise.all(['customers', 'products', 'openInvoices'].map((x) => dbCount(x)));
  const cur = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'كلمة المرور الحالية' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'كلمة المرور الجديدة' });
  const err = h('div');
  ctx.root.append(
    h('h2', {}, 'المزيد'),
    h('div', { class: 'card' }, kv([['المستخدم', me && me.fullName], ['الدور', me && me.role], ['الإصدار', APP_VERSION], ['معرّف الجهاز', h('small', { class: 'mono' }, deviceId())], ['آخر مزامنة', s.lastOkAt ? fmtDateTime(s.lastOkAt) : '—'],
      ['على الجهاز', `${counts[0]} عميل · ${counts[1]} منتج · ${counts[2]} فاتورة مفتوحة`]])),
    h('div', { class: 'card form' }, h('h3', {}, 'تغيير كلمة المرور'), field('الحالية', cur), field('الجديدة (8 أحرف على الأقل)', nw), err,
      h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        err.replaceChildren(); const b = e.currentTarget;
        try {
          if (nw.value.length < 8) throw new UserError('كلمة المرور الجديدة أقل من 8 أحرف');
          b.disabled = true;
          await api('POST', '/auth/change-password', { body: { currentPassword: cur.value, newPassword: nw.value } });
          cur.value = ''; nw.value = ''; toast('تم تغيير كلمة المرور', 'ok');
        } catch (ex) { err.replaceChildren(errorBox(ex)); }
        b.disabled = false;
      } }, 'تغيير')),
    h('div', { class: 'card form' }, h('h3', {}, 'بيانات الجهاز'),
      h('button', { class: 'btn sec', type: 'button', onclick: async () => {
        if (syncState().pending && !(await confirmDialog(`يوجد ${syncState().pending} عملية لم تُرسل؛ ستبقى محفوظة. متابعة إعادة التنزيل؟`))) return;
        await wipe(); localStorage.removeItem('rep.nothing'); toast('جارٍ إعادة التنزيل…');
        const r = await syncNow(); toast(r.ok ? 'تم تنزيل البيانات' : errText(r.error), r.ok ? 'ok' : 'bad');
      } }, 'إعادة تنزيل كل البيانات'),
      h('p', { class: 'note' }, 'تبقى العمليات غير المرسلة محفوظة عند إعادة التنزيل.')),
    h('button', { class: 'btn bad big', type: 'button', onclick: () => window.dispatchEvent(new CustomEvent('rep-logout')) }, 'تسجيل الخروج'),
  );
}

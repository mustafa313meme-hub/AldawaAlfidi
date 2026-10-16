import { api, lookup } from '../api.js';
import { badge, fmtDateTime, h, kv, modal, promptDialog, table, toast } from '../dom.js';
import { formModal, resourceList } from '../resource.js';

export const title = 'المستخدمون';

export default async function render(ctx) {
  await resourceList({
    title: 'المستخدمون', endpoint: '/users', search: true,
    columns: [
      { key: 'username', label: 'اسم المستخدم' }, { key: 'fullName', label: 'الاسم' }, { key: 'role', label: 'الدور', fmt: (v) => (v ? v.name : '') }, { key: 'phone', label: 'الهاتف' },
      { key: 'lastLoginAt', label: 'آخر دخول', fmt: fmtDateTime }, { key: 'isActive', label: 'الحالة', render: (r) => badge(r.isActive ? 'فعّال' : 'معطّل', r.isActive ? 'ok' : 'bad') },
    ],
    onRow: (u, reload) => {
      const devices = async () => {
        const { data } = await api('GET', `/users/${u.id}/devices`);
        const m = modal({ title: `أجهزة ${u.fullName}`, wide: true, body: table([{ key: 'platform', label: 'النظام' }, { key: 'model', label: 'الطراز' }, { key: 'appVersion', label: 'الإصدار' }, { key: 'lastSeenAt', label: 'آخر ظهور', fmt: fmtDateTime },
          { label: '', render: (d) => (ctx.can('devices.revoke') ? h('button', { class: 'btn sm ' + (d.isActive ? 'bad' : 'sec'), type: 'button', onclick: async () => {
            try { await api('POST', `/users/${u.id}/devices/${d.id}/${d.isActive ? 'revoke' : 'activate'}`); toast('تم', 'ok'); m.close(); devices(); } catch (e) { toast(e.message, 'bad'); }
          } }, d.isActive ? 'إيقاف الجهاز' : 'تفعيل') : '') }], data, { empty: 'لا أجهزة مسجَّلة' }), actions: [{ label: 'إغلاق', kind: 'sec', onClick: (c) => c() }] });
      };
      modal({ title: u.fullName, body: kv([['اسم المستخدم', u.username], ['الدور', u.role && u.role.name], ['الهاتف', u.phone], ['البريد', u.email]]), actions: [
        ctx.can('users.update') ? { label: u.isActive ? 'تعطيل الحساب' : 'تفعيل الحساب', kind: u.isActive ? 'bad' : '', onClick: async (close) => { try { await api('PATCH', `/users/${u.id}`, { body: { isActive: !u.isActive } }); close(); toast('تم', 'ok'); reload(); } catch (e) { toast(e.message, 'bad'); } } } : null,
        ctx.can('users.reset_password') ? { label: 'إعادة تعيين كلمة المرور', kind: 'sec', onClick: async (close) => {
          const pw = await promptDialog('كلمة المرور الجديدة (8 أحرف على الأقل)', { minLength: 8, multiline: false });
          if (!pw) return;
          try { await api('POST', `/users/${u.id}/reset-password`, { body: { newPassword: pw } }); close(); toast('تم، وأُنهيت كل جلساته', 'ok'); } catch (e) { toast(e.message, 'bad'); }
        } } : null,
        ctx.can('devices.view') ? { label: 'الأجهزة', kind: 'sec', onClick: (close) => { close(); devices(); } } : null,
        { label: 'إغلاق', kind: 'sec', onClick: (c) => c() }].filter(Boolean) });
    },
    create: { label: 'مستخدم جديد', perm: 'users.create', open: (reload) => formModal({ title: 'مستخدم جديد', wide: true, fields: [
      { name: 'username', label: 'اسم المستخدم (a-z 0-9 . _ -)', required: true }, { name: 'fullName', label: 'الاسم الكامل', required: true },
      { name: 'password', label: 'كلمة مرور مؤقتة (8 أحرف+)', type: 'password', required: true }, { name: 'roleId', label: 'الدور', type: 'select', required: true, load: () => lookup('/roles', 'name') },
      { name: 'phone', label: 'الهاتف' }, { name: 'email', label: 'البريد' }], submit: (v) => api('POST', '/users', { body: v }), onDone: reload }) },
  })(ctx);
}

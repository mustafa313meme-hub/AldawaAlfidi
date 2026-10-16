import { api, isLoggedIn, login, logout, setLogoutHandler, clearLookups } from './api.js';
import { buildForm, clear, errorBox, errText, h, modal, spinner, toast } from './dom.js';
import { MENU, match } from './routes.js';

const app = document.getElementById('app');
let me = null;
let bellTimer = null;

const can = (perm) => {
  if (!me) return false;
  if (me.role === 'super_admin') return true;
  if (!perm) return true;
  if (perm.endsWith('.*')) return me.permissions.some((p) => p.startsWith(perm.slice(0, -1)));
  return me.permissions.includes(perm);
};

// ───────────── login
function renderLogin(message) {
  clearInterval(bellTimer);
  me = null;
  clearLookups();
  const err = h('div', { class: 'err', role: 'alert' }, message || '');
  const user = h('input', { name: 'identifier', autocomplete: 'username', required: true, 'aria-label': 'اسم المستخدم' });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'كلمة المرور' });
  const btn = h('button', { class: 'btn', type: 'submit' }, 'دخول');
  const form = h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault();
    err.textContent = '';
    btn.disabled = true;
    try {
      const r = await login(user.value.trim(), pass.value);
      await start();
      if (r.mustChangePassword) forcePasswordChange();
    } catch (ex) { err.textContent = errText(ex); btn.disabled = false; }
  } },
  h('h1', {}, 'مكتب الدواء الفضي العلمي'), h('p', {}, 'تسجيل الدخول إلى لوحة الإدارة'),
  h('label', { class: 'f' }, 'اسم المستخدم أو الهاتف', user), h('br'), h('label', { class: 'f' }, 'كلمة المرور', pass), h('br'), err, h('br'), btn);
  clear(app).append(form);
  user.focus();
}

function forcePasswordChange() {
  const form = buildForm([
    { name: 'currentPassword', label: 'كلمة المرور الحالية', type: 'password', required: true, full: true },
    { name: 'newPassword', label: 'كلمة المرور الجديدة (8 أحرف على الأقل)', type: 'password', required: true, full: true },
  ]);
  const err = h('div');
  modal({
    title: 'يجب تغيير كلمة المرور', body: h('div', {}, h('p', { class: 'note' }, 'هذه كلمة مرور مؤقتة. اختر كلمة مرور جديدة للمتابعة.'), err, form.el),
    actions: [{ label: 'تغيير', onClick: async (close, btn) => {
      err.replaceChildren();
      if (!form.validate()) return;
      const v = form.values();
      if (v.newPassword.length < 8) { err.replaceChildren(errorBox({ message: 'كلمة المرور الجديدة أقل من 8 أحرف' })); return; }
      btn.disabled = true;
      try { await api('POST', '/auth/change-password', { body: v }); close(); toast('تم تغيير كلمة المرور', 'ok'); } catch (e) { err.replaceChildren(errorBox(e)); btn.disabled = false; }
    } }],
  });
}

// ───────────── shell + router
function renderShell() {
  const side = h('nav', { class: 'side', 'aria-label': 'القائمة' }, h('div', { class: 'brand' }, 'الدواء الفضي'));
  for (const g of MENU) {
    const items = g.items.filter((i) => can(i.perm));
    if (!items.length) continue;
    side.append(h('div', { class: 'grp' }, g.group), ...items.map((i) => h('a', { href: '#' + i.path, 'data-path': i.path }, i.label)));
  }
  const bell = h('a', { class: 'bell', href: '#/notifications', 'aria-label': 'الإشعارات' }, 'الإشعارات', h('span', { class: 'n', hidden: true }, '0'));
  const top = h('div', { class: 'top' }, h('strong', { id: 'page-title' }, ''), h('div', { class: 'sp' }), bell, h('span', { class: 'note' }, `${me.fullName} (${me.role})`), h('button', { class: 'btn sec sm', type: 'button', onclick: () => logout() }, 'خروج'));
  clear(app).append(h('div', { class: 'shell' }, side, h('div', { class: 'main' }, top, h('main', { class: 'content', id: 'view' }))));
  const poll = async () => { try { const { data } = await api('GET', '/notifications/unread-count'); const n = bell.querySelector('.n'); n.textContent = data.unread; n.hidden = !data.unread; } catch { /* ignore */ } };
  poll();
  clearInterval(bellTimer);
  bellTimer = setInterval(poll, 60_000);
}

let routeSeq = 0;
async function route() {
  const view = document.getElementById('view');
  if (!view || !me) return;
  const seq = ++routeSeq;
  const full = location.hash.replace(/^#/, '') || (can('reports.sales') ? '/dashboard' : '/customers');
  const [path, queryString] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(queryString || ''));
  const m = match(path);
  document.querySelectorAll('.side a').forEach((a) => a.classList.toggle('active', path === a.dataset.path || path.startsWith(a.dataset.path + '/')));
  clear(view).append(spinner());
  if (!m) { view.replaceChildren(errorBox({ message: 'الصفحة غير موجودة' })); return; }
  if (!can(m.route.perm)) { view.replaceChildren(errorBox({ message: 'ليست لديك صلاحية هذه الصفحة' })); return; }
  try {
    const mod = await m.route.load();
    if (seq !== routeSeq) return; // user already navigated elsewhere
    const root = h('div');
    view.replaceChildren(root);
    document.getElementById('page-title').textContent = mod.title || '';
    await mod.default({ root, params: m.params, query, me, can, navigate: (to) => { location.hash = '#' + to; } });
  } catch (e) {
    if (seq === routeSeq) view.replaceChildren(errorBox(e));
  }
}

async function start() {
  me = (await api('GET', '/auth/me')).data;
  renderShell();
  await route();
}

window.addEventListener('hashchange', route);
setLogoutHandler(() => renderLogin());

(async function boot() {
  if (!isLoggedIn()) return renderLogin();
  try { await start(); } catch { renderLogin(); }
})();

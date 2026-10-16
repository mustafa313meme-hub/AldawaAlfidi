import { api, clearSession, hasSession, login, logoutRemote, setLogoutHandler } from './api.js';
import { dbAll, wipe } from './db.js';
import { clear, confirmDialog, errText, errorBox, field, h, spinner, toast, UserError } from './dom.js';
import { forgetMe, loadMe, can } from './session.js';
import { refreshCounts, startAutoSync, syncNow, syncState } from './sync.js';

const app = document.getElementById('app');
let me = null;

const ROUTES = [
  { pattern: '/', load: () => import('./pages/home.js') },
  { pattern: '/customers', load: () => import('./pages/customers.js') },
  { pattern: '/customers/:id', load: () => import('./pages/customers.js').then((m) => ({ default: m.detail, title: 'العميل' })) },
  { pattern: '/visit/new', load: () => import('./pages/forms.js').then((m) => ({ default: m.visit, title: 'زيارة' })) },
  { pattern: '/order/new', load: () => import('./pages/forms.js').then((m) => ({ default: m.order, title: 'طلب' })) },
  { pattern: '/payment/new', load: () => import('./pages/forms.js').then((m) => ({ default: m.payment, title: 'تسديد' })) },
  { pattern: '/return/new', load: () => import('./pages/forms.js').then((m) => ({ default: m.ret, title: 'مردود' })) },
  { pattern: '/sync', load: () => import('./pages/outbox.js') },
  { pattern: '/more', load: () => import('./pages/more.js') },
];
export function match(path) {
  for (const r of ROUTES) {
    const a = r.pattern.split('/'); const b = path.split('/');
    if (a.length !== b.length) continue;
    const params = {}; let ok = true;
    for (let i = 0; i < a.length; i++) { if (a[i].startsWith(':')) params[a[i].slice(1)] = decodeURIComponent(b[i]); else if (a[i] !== b[i]) { ok = false; break; } }
    if (ok) return { route: r, params };
  }
  return null;
}

// ───────────── login
function renderLogin(message) {
  me = null; forgetMe();
  const err = h('div', { class: 'err', role: 'alert' }, message || '');
  const user = h('input', { name: 'identifier', autocomplete: 'username', required: true, 'aria-label': 'اسم المستخدم', autocapitalize: 'none' });
  const pass = h('input', { name: 'password', type: 'password', autocomplete: 'current-password', required: true, 'aria-label': 'كلمة المرور' });
  const btn = h('button', { class: 'btn big', type: 'submit' }, 'دخول');
  clear(app).append(h('form', { class: 'login', onsubmit: async (e) => {
    e.preventDefault(); err.textContent = ''; btn.disabled = true;
    try { await wipeIfOtherUser(user.value.trim()); const r = await login(user.value.trim(), pass.value); localStorage.setItem('rep.user', user.value.trim().toLowerCase()); await start(); if (r.mustChangePassword) forcePasswordChange(); } catch (ex) { err.textContent = ex.network ? 'لا يوجد اتصال بالخادم. تسجيل الدخول الأول يحتاج الإنترنت.' : errText(ex); btn.disabled = false; }
  } }, h('h1', {}, 'الدواء الفضي'), h('p', {}, 'تطبيق المندوب'), field('اسم المستخدم أو الهاتف', user), field('كلمة المرور', pass), err, btn));
  user.focus();
}

/** A different person signing in on this phone must not see the previous rep's customers. */
async function wipeIfOtherUser(identifier) {
  const prev = localStorage.getItem('rep.user');
  if (prev && prev !== identifier.toLowerCase()) {
    if ((await dbAll('outbox')).some((o) => o.status !== 'Applied' && o.status !== 'Discarded')) throw new UserError('على هذا الجهاز عمليات غير مُرسلة لمستخدم آخر. يجب إرسالها أولاً بدخول ذلك المستخدم.');
    await wipe({ all: true });
  }
}

function forcePasswordChange() {
  const cur = h('input', { type: 'password', autocomplete: 'current-password', 'aria-label': 'كلمة المرور الحالية' });
  const nw = h('input', { type: 'password', autocomplete: 'new-password', 'aria-label': 'كلمة المرور الجديدة' });
  const err = h('div');
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' }, h('div', { class: 'modal' }, h('h3', {}, 'يجب تغيير كلمة المرور'), h('p', { class: 'note' }, 'هذه كلمة مرور مؤقتة. اختر كلمة جديدة للمتابعة.'),
    field('الحالية', cur), field('الجديدة (8 أحرف على الأقل)', nw), err,
    h('div', { class: 'actions' }, h('button', { class: 'btn', type: 'button', onclick: async (e) => {
      err.replaceChildren();
      if (nw.value.length < 8) { err.replaceChildren(errorBox({ message: 'أقل من 8 أحرف' })); return; }
      e.currentTarget.disabled = true;
      try { await api('POST', '/auth/change-password', { body: { currentPassword: cur.value, newPassword: nw.value } }); overlay.remove(); toast('تم تغيير كلمة المرور', 'ok'); } catch (ex) { err.replaceChildren(errorBox(ex)); e.currentTarget.disabled = false; }
    } }, 'تغيير'))));
  document.body.append(overlay);
}

// ───────────── shell + router
const NAV = [['/', 'اليوم', null], ['/customers', 'العملاء', 'customers.view'], ['/sync', 'المزامنة', null], ['/more', 'المزيد', null]];
let dot; let navSync;
function renderShell() {
  dot = h('button', { class: 'syncdot', type: 'button', 'aria-label': 'حالة المزامنة', onclick: () => { location.hash = '#/sync'; } });
  navSync = null;
  const nav = h('nav', { class: 'tabs', 'aria-label': 'التنقل' }, NAV.filter((n) => !n[2] || can(n[2])).map(([p, l]) => { const a = h('a', { href: '#' + p, 'data-path': p }, l, p === '/sync' ? h('span', { class: 'n', hidden: true }, '0') : null); if (p === '/sync') navSync = a.querySelector('.n'); return a; }));
  clear(app).append(h('div', { class: 'shell' }, h('header', { class: 'top' }, h('strong', { id: 'page-title' }, ''), h('div', { class: 'sp' }), dot), h('div', { class: 'offline', id: 'offline', hidden: navigator.onLine }, 'لا يوجد اتصال — يعمل التطبيق محلياً وستُرسل العمليات لاحقاً'), h('main', { class: 'content', id: 'view' }), nav));
  paintSync(syncState());
}
function paintSync(s) {
  if (!dot) return;
  const kind = s.problems ? 'bad' : s.error || s.pending ? 'warn' : 'ok';
  dot.className = 'syncdot ' + (s.running ? 'run' : kind);
  dot.textContent = s.running ? 'تتم المزامنة…' : s.problems ? `${s.problems} تحتاج انتباهك` : s.pending ? `${s.pending} بانتظار الإرسال` : s.error ? 'غير متصل' : 'متزامن';
  if (navSync) { const n = s.pending + s.problems; navSync.textContent = String(n); navSync.hidden = !n; }
}
window.addEventListener('sync-state', (e) => paintSync(e.detail));
window.addEventListener('online', () => { const o = document.getElementById('offline'); if (o) o.hidden = true; });
window.addEventListener('offline', () => { const o = document.getElementById('offline'); if (o) o.hidden = false; });

let seq = 0;
async function route() {
  const view = document.getElementById('view');
  if (!view || !me) return;
  const mySeq = ++seq;
  const full = location.hash.replace(/^#/, '') || '/';
  const [path, qs] = full.split('?');
  const query = Object.fromEntries(new URLSearchParams(qs || ''));
  document.querySelectorAll('.tabs a').forEach((a) => a.classList.toggle('active', a.dataset.path === '/' ? path === '/' : path === a.dataset.path || path.startsWith(a.dataset.path + '/') || (a.dataset.path === '/customers' && /^\/(visit|order|payment|return)\//.test(path))));
  const m = match(path);
  clear(view).append(spinner());
  if (!m) { view.replaceChildren(errorBox({ message: 'الصفحة غير موجودة' })); return; }
  try {
    const mod = await m.route.load();
    if (mySeq !== seq) return;
    const root = h('div');
    view.replaceChildren(root);
    document.getElementById('page-title').textContent = mod.title || '';
    window.scrollTo(0, 0);
    await mod.default({ root, params: m.params, query, me, navigate: (to) => { location.hash = '#' + to; } });
  } catch (e) { if (mySeq === seq) view.replaceChildren(errorBox(e)); }
}

async function start() {
  me = await loadMe();
  renderShell();
  await route();
  startAutoSync();
}

async function logout() {
  await refreshCounts();
  const n = syncState().pending;
  if (n && !(await confirmDialog(`يوجد ${n} عملية لم تُرسل وسيُحذف معها كل ما على الجهاز. أرسلها أولاً (اتصل بالإنترنت). هل تريد الخروج ومسحها فعلاً؟`, { okLabel: 'اخرج وامسح', danger: true }))) return;
  if (!n) { const r = await syncNow(); void r; }
  logoutRemote(); clearSession(); await wipe({ all: true }); localStorage.removeItem('rep.user'); forgetMe(); renderLogin();
}
window.addEventListener('rep-logout', logout);

window.addEventListener('hashchange', route);
setLogoutHandler(() => renderLogin('انتهت الجلسة، سجّل الدخول من جديد'));

if ('serviceWorker' in navigator && (location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1')) {
  navigator.serviceWorker.register('sw.js').catch((e) => console.warn('service worker', e));
}

(async function boot() {
  if (!hasSession()) return renderLogin();
  try { await start(); } catch (e) { if (e && e.network) renderLogin('لا يوجد اتصال. سجّل الدخول عند توفر الإنترنت.'); else renderLogin(); }
})();

// DOM helpers. Everything user-controlled goes through text nodes (never innerHTML): hostile names stay inert text.
export function h(tag, attrs, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs || {})) {
    if (v === undefined || v === null || v === false) continue;
    if (k === 'class') e.className = v;
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v === true) e.setAttribute(k, '');
    else e.setAttribute(k, String(v));
  }
  for (const kid of kids.flat(Infinity)) {
    if (kid === undefined || kid === null || kid === false) continue;
    e.append(kid instanceof Node ? kid : document.createTextNode(String(kid)));
  }
  return e;
}
export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };
export function put(el, ...kids) {
  el.replaceChildren(...kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false).map((k) => (k instanceof Node ? k : document.createTextNode(String(k)))));
  return el;
}

export const fmtNum = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US'));
const D = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' });
const DT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
const TM = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtDate = (v) => (v ? D.format(new Date(v)) : '');
export const fmtDateTime = (v) => (v ? DT.format(new Date(v)) : '');
export const fmtTime = (v) => (v ? TM.format(new Date(v)) : '');
/** Calendar day in Baghdad (the server's business day), YYYY-MM-DD. */
export const todayLocal = (d = new Date()) => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(d);

export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3000);
}

export function confirmDialog(message, { okLabel = 'تأكيد', danger = false } = {}) {
  return new Promise((resolve) => {
    const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
    const done = (v) => { overlay.remove(); resolve(v); };
    overlay.append(h('div', { class: 'modal' }, h('p', {}, message), h('div', { class: 'actions' },
      h('button', { class: 'btn ' + (danger ? 'bad' : ''), type: 'button', onclick: () => done(true) }, okLabel),
      h('button', { class: 'btn sec', type: 'button', onclick: () => done(false) }, 'إلغاء'))));
    document.body.append(overlay);
  });
}

export class UserError extends Error {}
export function errText(e) {
  if (e instanceof Error && typeof e.status !== 'number' && !(e instanceof UserError) && !e.network) { console.error(e); return 'حدث خطأ غير متوقع. أعد المحاولة.'; }
  const d = Array.isArray(e?.details) ? ' — ' + e.details.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('، ') : '';
  return (e?.message || 'حدث خطأ') + d;
}
export const errorBox = (e) => h('div', { class: 'errbox', role: 'alert' }, errText(e));
export const badge = (text, kind = '') => h('span', { class: 'badge ' + kind }, text);
export const spinner = () => h('div', { class: 'spin' }, 'جارٍ التحميل…');
export const kv = (pairs) => h('div', { class: 'kv' }, pairs.filter(Boolean).map(([k, v]) => h('div', {}, h('span', {}, k), v === undefined || v === null || v === '' ? '—' : v)));
export const field = (label, control, hint) => h('label', { class: 'f' }, h('span', {}, label), control, hint ? h('small', {}, hint) : null);

const DIACRITICS = /[ً-ٰٟـ]/g;
const DIGITS = {};
'٠١٢٣٤٥٦٧٨٩'.split('').forEach((c, i) => (DIGITS[c] = String(i)));
'۰۱۲۳۴۵۶۷۸۹'.split('').forEach((c, i) => (DIGITS[c] = String(i)));
/** Same normalisation the server uses for search (apps/api/src/common/arabic.ts). */
export const normalizeSearch = (s) => String(s ?? '').replace(DIACRITICS, '').replace(/[أإآٱ]/g, 'ا').replace(/ى/g, 'ي').replace(/ة/g, 'ه').replace(/ؤ/g, 'و').replace(/ئ/g, 'ي')
  .replace(/[٠-٩۰-۹]/g, (d) => DIGITS[d]).toLowerCase().replace(/\s+/g, ' ').trim();

export const uuid = () => (crypto.randomUUID ? crypto.randomUUID() : '10000000-1000-4000-8000-100000000000'.replace(/[018]/g, (c) => (c ^ (crypto.getRandomValues(new Uint8Array(1))[0] & (15 >> (c / 4)))).toString(16)));

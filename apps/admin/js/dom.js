// DOM helpers. Everything user-controlled goes through text nodes (never innerHTML), so names like "<img onerror=...>" are inert.

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

/** Flatten nested arrays and drop null/undefined/false: native append()/replaceChildren() would print them as text ("[object ...]", "null"). */
export const flat = (...kids) => kids.flat(Infinity).filter((k) => k !== null && k !== undefined && k !== false);
export function put(el, ...kids) {
  el.replaceChildren(...flat(kids).map((k) => (k instanceof Node ? k : document.createTextNode(String(k)))));
  return el;
}

export const clear = (el) => { while (el.firstChild) el.removeChild(el.firstChild); return el; };

// ───── formatting
export const fmtNum = (n) => (n === null || n === undefined || n === '' ? '' : Number(n).toLocaleString('en-US'));
const D = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit' });
const DT = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Baghdad', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false });
export const fmtDate = (v) => (v ? D.format(new Date(v)) : '');
export const fmtDateTime = (v) => (v ? DT.format(new Date(v)) : '');
export const todayLocal = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());
export const monthStartLocal = () => todayLocal().slice(0, 8) + '01';

// ───── toasts / modals
export function toast(msg, kind = '') {
  const box = document.getElementById('toasts');
  const t = h('div', { class: 'toast ' + kind, role: 'status' }, msg);
  box.append(t);
  setTimeout(() => t.remove(), kind === 'bad' ? 7000 : 3500);
}

export function modal({ title, body, actions = [], wide }) {
  const overlay = h('div', { class: 'overlay', role: 'dialog', 'aria-modal': 'true' });
  const close = () => overlay.remove();
  const box = h('div', { class: 'modal' }, h('h3', {}, title), body, h('div', { class: 'actions' }, actions.map((a) => h('button', { class: 'btn ' + (a.kind || ''), type: 'button', onclick: () => a.onClick(close, btn(a)) }, a.label))));
  const btn = (a) => box.querySelectorAll('.actions button')[actions.indexOf(a)];
  if (wide) box.style.width = 'min(1000px,100%)';
  overlay.addEventListener('mousedown', (e) => { if (e.target === overlay) close(); });
  overlay.append(box);
  document.body.append(overlay);
  return { close, el: box };
}

export function confirmDialog(message, { danger = false, okLabel = 'تأكيد' } = {}) {
  return new Promise((resolve) => {
    modal({
      title: 'تأكيد', body: h('p', {}, message),
      actions: [
        { label: okLabel, kind: danger ? 'bad' : '', onClick: (close) => { close(); resolve(true); } },
        { label: 'إلغاء', kind: 'sec', onClick: (close) => { close(); resolve(false); } },
      ],
    });
  });
}

export function promptDialog(label, { required = true, minLength = 3, multiline = true } = {}) {
  return new Promise((resolve) => {
    const input = multiline ? h('textarea', { 'aria-label': label }) : h('input', { 'aria-label': label });
    const err = h('div', { class: 'err' });
    modal({
      title: label, body: h('div', {}, input, err),
      actions: [
        { label: 'متابعة', onClick: (close) => { const v = input.value.trim(); if (required && v.length < minLength) { err.textContent = `الحد الأدنى ${minLength} أحرف`; return; } close(); resolve(v); } },
        { label: 'إلغاء', kind: 'sec', onClick: (close) => { close(); resolve(null); } },
      ],
    });
    input.focus();
  });
}

// ───── small components
export const badge = (text, kind = '') => h('span', { class: 'badge ' + kind }, text);
export const spinner = () => h('div', { class: 'spin' }, 'جارٍ التحميل…');
export const errorBox = (e) => h('div', { class: 'errbox', role: 'alert' }, errText(e));
/** A message meant for the user (validation done in the browser). Unlike unexpected exceptions, it is shown as written. */
export class UserError extends Error {}

export function errText(e) {
  if (e instanceof Error && typeof e.status !== 'number' && !(e instanceof UserError)) { console.error(e); return 'تعذّر عرض هذه الصفحة بسبب خطأ غير متوقع. حدّث الصفحة وأعد المحاولة.'; }
  const d = Array.isArray(e?.details) ? ' — ' + e.details.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))).join('، ') : '';
  return (e?.message || 'حدث خطأ') + d;
}

/** columns: [{key, label, fmt?(value,row) -> string|Node, num?, render?(row) -> Node}] */
export function table(columns, rows, { onRowClick, empty = 'لا توجد بيانات' } = {}) {
  if (!rows.length) return h('div', { class: 'tbl-wrap' }, h('div', { class: 'empty' }, empty));
  return h('div', { class: 'tbl-wrap' }, h('table', {},
    h('thead', {}, h('tr', {}, columns.map((c) => h('th', { class: c.num ? 'num' : '' }, c.label)))),
    h('tbody', {}, rows.map((r) => h('tr', { class: onRowClick ? 'click' : '', onclick: onRowClick ? () => onRowClick(r) : null },
      columns.map((c) => h('td', { class: c.num ? 'num' : '' }, c.render ? c.render(r) : c.fmt ? c.fmt(r[c.key], r) : r[c.key] ?? '')))))));
}

export function pager(meta, go) {
  if (!meta || meta.total <= meta.pageSize) return h('div');
  const pages = Math.max(1, Math.ceil(meta.total / meta.pageSize));
  return h('div', { class: 'pager' },
    h('button', { class: 'btn sec sm', disabled: meta.page <= 1, onclick: () => go(meta.page - 1) }, 'السابق'),
    h('span', {}, `${meta.page} / ${pages}  (${fmtNum(meta.total)})`),
    h('button', { class: 'btn sec sm', disabled: meta.page >= pages, onclick: () => go(meta.page + 1) }, 'التالي'));
}

export const kv = (pairs) => h('div', { class: 'kv' }, pairs.filter(Boolean).map(([k, v]) => h('div', {}, h('span', {}, k), v === undefined || v === null || v === '' ? '—' : v)));

/**
 * Form from field specs: {name, label, type: text|number|select|textarea|checkbox|date|password, required, options, load, full, placeholder, min, max}
 * `values()` returns only filled fields, typed (numbers as numbers, checkboxes as booleans).
 */
export function buildForm(fields, initial = {}) {
  const inputs = {};
  const errs = {};
  const el = h('form', { class: 'form', novalidate: true, onsubmit: (e) => e.preventDefault() });
  const fill = (select, options, current) => {
    clear(select);
    select.append(h('option', { value: '' }, '—'), ...options.map((o) => h('option', { value: o.value }, o.label)));
    if (current !== undefined && current !== null) select.value = String(current);
  };
  for (const f of fields) {
    let input;
    const cur = initial[f.name];
    if (f.type === 'select') {
      input = h('select', { name: f.name });
      fill(input, f.options || [], cur);
      if (f.load) f.load().then((opts) => fill(input, opts, cur)).catch(() => {});
    } else if (f.type === 'textarea') input = h('textarea', { name: f.name }, cur ?? '');
    else if (f.type === 'checkbox') input = h('input', { type: 'checkbox', name: f.name, checked: cur === undefined ? !!f.default : !!cur });
    else input = h('input', { type: f.type || 'text', name: f.name, value: cur ?? '', placeholder: f.placeholder, min: f.min, max: f.max, autocomplete: f.type === 'password' ? 'new-password' : 'off' });
    inputs[f.name] = input;
    errs[f.name] = h('div', { class: 'err' });
    el.append(h('label', { class: 'f ' + (f.type === 'checkbox' ? 'chk ' : '') + (f.full ? 'full' : '') }, h('span', { class: f.required ? 'req' : '' }, f.label), input, errs[f.name]));
  }
  return {
    el,
    inputs,
    validate() {
      let ok = true;
      for (const f of fields) {
        errs[f.name].textContent = '';
        const v = inputs[f.name].value;
        if (f.required && f.type !== 'checkbox' && String(v).trim() === '') { errs[f.name].textContent = 'مطلوب'; ok = false; }
      }
      return ok;
    },
    values() {
      const out = {};
      for (const f of fields) {
        const i = inputs[f.name];
        if (f.type === 'checkbox') { out[f.name] = i.checked; continue; }
        const raw = String(i.value).trim();
        if (raw === '') continue;
        out[f.name] = f.type === 'number' ? Number(raw) : raw;
      }
      return out;
    },
  };
}

export const field = (label, control) => h('label', { class: 'f' }, label, control);
export const sel = (name, options, value) => { const s = h('select', { name }); s.append(h('option', { value: '' }, '—'), ...options.map((o) => h('option', { value: o.value }, o.label))); if (value) s.value = value; return s; };

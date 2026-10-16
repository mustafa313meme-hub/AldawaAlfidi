import { api } from './api.js';
import { buildForm, errorBox, h, modal, pager, spinner, table, toast, errText } from './dom.js';

/** Modal with a form: validates, submits, shows the server's message inside the modal on failure. */
export function formModal({ title, fields, initial = {}, submit, onDone, extra, wide, saveLabel = 'حفظ' }) {
  const form = buildForm(fields, initial);
  const errHolder = h('div');
  const body = h('div', {}, errHolder, form.el, extra || null);
  const m = modal({
    title, body, wide,
    actions: [
      {
        label: saveLabel,
        onClick: async (close, btn) => {
          errHolder.replaceChildren();
          if (!form.validate()) return;
          btn.disabled = true;
          try { const r = await submit(form.values(), form); close(); toast('تم', 'ok'); if (onDone) onDone(r); } catch (e) { errHolder.replaceChildren(errorBox(e)); btn.disabled = false; }
        },
      },
      { label: 'إلغاء', kind: 'sec', onClick: (close) => close() },
    ],
  });
  return { ...m, form };
}

/**
 * Generic list page: search, filters, pagination, create button, row click.
 * cfg: {title, endpoint, columns, search, filters:[{name,label,options}], query, create:{label, perm, open(reload)}, onRow(row), extraTools(reload)}
 */
export function resourceList(cfg) {
  return async function render(ctx) {
    const state = { page: 1, q: '', filters: {} };
    const holder = h('div');
    const tools = h('div', { class: 'toolbar' });
    let timer;
    if (cfg.search) {
      const s = h('input', { type: 'search', placeholder: 'بحث…', 'aria-label': 'بحث', oninput: (e) => { clearTimeout(timer); timer = setTimeout(() => { state.q = e.target.value; state.page = 1; load(); }, 300); } });
      tools.append(h('label', { class: 'f' }, 'بحث', s));
    }
    for (const f of cfg.filters || []) {
      if (f.type === 'date') {
        tools.append(h('label', { class: 'f' }, f.label, h('input', { type: 'date', 'aria-label': f.label, value: f.value || '', onchange: (e) => { state.filters[f.name] = e.target.value; state.page = 1; load(); } })));
        if (f.value) state.filters[f.name] = f.value;
        continue;
      }
      const s = h('select', { 'aria-label': f.label, onchange: (e) => { state.filters[f.name] = e.target.value; state.page = 1; load(); } },
        h('option', { value: '' }, 'الكل'), f.options.map((o) => h('option', { value: o.value }, o.label)));
      tools.append(h('label', { class: 'f' }, f.label, s));
    }
    tools.append(h('div', { class: 'sp' }));
    if (cfg.extraTools) tools.append(cfg.extraTools(() => load(), ctx));
    if (cfg.create && (!cfg.create.perm || ctx.can(cfg.create.perm))) tools.append(h('button', { class: 'btn', type: 'button', onclick: () => cfg.create.open(() => load(), ctx) }, cfg.create.label));
    ctx.root.append(h('h2', {}, cfg.title), tools, holder);

    async function load() {
      holder.replaceChildren(spinner());
      try {
        const { data, meta } = await api('GET', cfg.endpoint, { query: { page: state.page, pageSize: 20, q: cfg.search ? state.q : undefined, ...state.filters, ...(cfg.query || {}) } });
        const rows = Array.isArray(data) ? data : [];
        holder.replaceChildren(table(cfg.columns, rows, { onRowClick: cfg.onRow ? (r) => cfg.onRow(r, () => load(), ctx) : undefined }), pager(meta, (p) => { state.page = p; load(); }));
      } catch (e) { holder.replaceChildren(errorBox(e)); }
    }
    await load();
  };
}

export { errText };

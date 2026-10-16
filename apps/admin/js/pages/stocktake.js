// Stocktake (physical count): choose a warehouse, type the counted quantity per product/batch; the server compares with the system quantity
// and books the differences as one adjustment. Rows left empty are NOT counted (not treated as zero).
import { api, lookup } from '../api.js';
import { UserError, badge, confirmDialog, errorBox, fmtDate, fmtNum, h, put, spinner, table, toast } from '../dom.js';

export const title = 'الجرد';

async function all(path, query) {
  const out = [];
  for (let page = 1; page <= 50; page++) {
    const { data, meta } = await api('GET', path, { query: { ...query, page, pageSize: 100 } });
    out.push(...data);
    if (page * 100 >= (meta ? meta.total : 0)) break;
  }
  return out;
}

export default async function render(ctx) {
  const whs = await lookup('/warehouses', 'name').catch(() => []);
  const sel = h('select', { 'aria-label': 'المخزن' }, h('option', { value: '' }, '— اختر المخزن —'), whs.map((w) => h('option', { value: w.value }, w.label)));
  const body = h('div');
  ctx.root.append(h('h2', {}, 'الجرد'), h('div', { class: 'toolbar' }, h('label', { class: 'f' }, 'المخزن', sel), h('button', { class: 'btn', type: 'button', onclick: () => load() }, 'تحميل أرصدة النظام')),
    h('p', { class: 'note' }, 'أدخل الكمية المعدودة فعلاً فقط للأسطر التي عددتها؛ الأسطر الفارغة لا تُسوّى. الفروقات تُسجَّل كتسوية «جرد» واحدة بالفرق (زيادة/نقص).'), body);

  async function load() {
    if (!sel.value) { body.replaceChildren(h('p', { class: 'note' }, 'اختر المخزن.')); return; }
    body.replaceChildren(spinner());
    try {
      const [stock, batches] = await Promise.all([all('/stock', { warehouseId: sel.value }), all('/inventory/batches', { warehouseId: sel.value })]);
      const byProduct = new Map();
      for (const b of batches) { if (!byProduct.has(b.product.id)) byProduct.set(b.product.id, []); byProduct.get(b.product.id).push(b); }
      const lines = []; // {key, productId, batchId, label, batch, expiry, system, input}
      for (const s of stock) {
        const bs = byProduct.get(s.product.id) || [];
        const inBatches = bs.reduce((a, b) => a + b.quantity, 0);
        for (const b of bs) lines.push({ productId: s.product.id, batchId: b.id, name: s.product.nameAr, sku: s.product.sku, batch: b.batchNumber, expiry: b.expiryDate, system: b.quantity });
        const loose = s.quantity - inBatches;
        if (loose !== 0 || !bs.length) lines.push({ productId: s.product.id, batchId: null, name: s.product.nameAr, sku: s.product.sku, batch: bs.length ? '(بلا تشغيلة)' : '', expiry: null, system: loose });
      }
      draw(lines);
    } catch (e) { body.replaceChildren(errorBox(e)); }
  }

  function draw(lines) {
    const err = h('div');
    const notes = h('input', { 'aria-label': 'ملاحظات', placeholder: 'ملاحظات الجرد (اختياري)', maxlength: 500 });
    const inputs = lines.map((l) => h('input', { type: 'number', min: 0, 'aria-label': `المعدود: ${l.name} ${l.batch}`, class: 'count' }));
    const liveDiff = (l, inp, out) => () => { out.textContent = inp.value === '' ? '' : String(Number(inp.value) - l.system); out.className = 'num diff' + (inp.value === '' || Number(inp.value) === l.system ? '' : Number(inp.value) > l.system ? ' pos' : ' neg'); };
    const rows = lines.map((l, i) => {
      const d = h('td', { class: 'num diff' });
      inputs[i].addEventListener('input', liveDiff(l, inputs[i], d));
      return h('tr', {}, h('td', {}, l.sku), h('td', {}, l.name), h('td', {}, l.batch), h('td', {}, l.expiry ? fmtDate(l.expiry) : ''), h('td', { class: 'num' }, fmtNum(l.system)), h('td', {}, inputs[i]), d);
    });
    put(body,
      h('div', { class: 'tbl-wrap' }, lines.length ? h('table', {}, h('thead', {}, h('tr', {}, ['الرمز', 'المنتج', 'التشغيلة', 'الانتهاء', 'رصيد النظام', 'المعدود', 'الفرق'].map((t) => h('th', {}, t)))), h('tbody', {}, rows)) : h('div', { class: 'empty' }, 'لا أرصدة في هذا المخزن')),
      err, lines.length ? h('div', { class: 'toolbar' }, h('label', { class: 'f' }, 'ملاحظات', notes), h('button', { class: 'btn', type: 'button', onclick: async (e) => {
        err.replaceChildren();
        const btn = e.currentTarget;
        try {
          const counts = [];
          lines.forEach((l, i) => {
            const raw = inputs[i].value.trim();
            if (raw === '') return;
            const n = Number(raw);
            if (!Number.isInteger(n) || n < 0) throw new UserError(`كمية غير صالحة في «${l.name}»`);
            counts.push({ productId: l.productId, ...(l.batchId ? { batchId: l.batchId } : {}), countedQuantity: n });
          });
          if (!counts.length) throw new UserError('لم تُدخل أي كمية معدودة');
          const changed = counts.filter((c) => { const l = lines.find((x) => x.productId === c.productId && x.batchId === (c.batchId || null)); return l.system !== c.countedQuantity; }).length;
          if (!(await confirmDialog(`سيُسجَّل جرد لـ ${counts.length} سطراً، منها ${changed} بفرق. متابعة؟`, { okLabel: 'اعتماد' }))) return;
          btn.disabled = true;
          const { data } = await api('POST', '/inventory/stocktake', { body: { warehouseId: sel.value, counts, ...(notes.value.trim() ? { notes: notes.value.trim() } : {}) } });
          showResult(data, lines);
        } catch (ex) { err.replaceChildren(errorBox(ex)); btn.disabled = false; }
      } }, 'اعتماد الجرد')) : null);
  }

  function showResult(r, lines) {
    toast(r.adjusted ? `سُجِّلت التسوية ${r.adjustmentNumber}` : 'لا فروقات: الجرد مطابق للنظام', 'ok');
    const name = (x) => { const l = lines.find((y) => y.productId === x.productId && y.batchId === (x.batchId || null)); return l ? `${l.name}${l.batch ? ' — ' + l.batch : ''}` : x.productId; };
    put(body,
      h('div', { class: 'card' }, h('h3', {}, r.adjusted ? `تمت التسوية ${r.adjustmentNumber}` : 'الجرد مطابق'), h('p', {}, r.adjusted ? `${r.adjusted} حركة تسوية.` : 'لم تُنشأ تسوية لأنه لا فروقات.')),
      table([{ label: 'الصنف', render: (x) => name(x) }, { key: 'system', label: 'النظام', num: true, fmt: fmtNum }, { key: 'counted', label: 'المعدود', num: true, fmt: fmtNum },
        { key: 'difference', label: 'الفرق', num: true, render: (x) => (x.difference === 0 ? badge('مطابق', 'ok') : badge(`${x.difference > 0 ? '+' : ''}${fmtNum(x.difference)}`, x.difference > 0 ? 'warn' : 'bad')) }], r.report),
      h('div', { class: 'toolbar' }, h('button', { class: 'btn sec', type: 'button', onclick: () => load() }, 'جرد جديد')));
  }
  await load();
}

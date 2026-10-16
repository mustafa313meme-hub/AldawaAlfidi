import { clear, fmtNum, h } from './dom.js';
import { picker } from './picker.js';

/**
 * Editable list of lines. kind 'sale': product + quantity + optional discount %. kind 'purchase': product + quantity + bonus + unit cost + discount amount.
 * `getLines()` returns the API shape; `validate()` returns an error message or ''.
 */
export function linesEditor({ kind = 'sale', productQuery = {} } = {}) {
  const rows = [];
  const body = h('tbody');
  const redraw = () => {
    clear(body);
    rows.forEach((r, i) => body.append(h('tr', {},
      h('td', {}, r.product.nameAr, h('div', { class: 'note' }, r.product.sku || '')),
      h('td', {}, h('input', { type: 'number', min: kind === 'delta' ? undefined : 1, value: r.qty, 'aria-label': kind === 'delta' ? 'الفرق (+ إضافة / − إنقاص)' : 'الكمية', oninput: (e) => { r.qty = Number(e.target.value); } })),
      kind === 'purchase' ? h('td', {}, h('input', { type: 'number', min: 0, value: r.bonus, 'aria-label': 'البونص', oninput: (e) => { r.bonus = Number(e.target.value); } })) : null,
      kind === 'purchase' ? h('td', {}, h('input', { type: 'number', min: 0, value: r.cost, 'aria-label': 'التكلفة', oninput: (e) => { r.cost = Number(e.target.value); } })) : null,
      kind === 'sale' || kind === 'purchase' ? h('td', {}, h('input', { type: 'number', min: 0, max: kind === 'sale' ? 100 : undefined, value: r.disc, 'aria-label': kind === 'sale' ? 'خصم %' : 'خصم', oninput: (e) => { r.disc = Number(e.target.value); } })) : null,
      h('td', {}, h('button', { class: 'btn sec sm', type: 'button', onclick: () => { rows.splice(i, 1); redraw(); } }, 'حذف')))));
  };
  const add = (p) => {
    if (rows.some((r) => r.product.id === p.id)) return;
    rows.push({ product: p, qty: 1, bonus: 0, cost: p.purchasePrice || 0, disc: 0 });
    redraw();
  };
  const pick = picker({ endpoint: '/products', query: { isActive: 'true', ...productQuery }, label: (p) => `${p.sku} — ${p.nameAr}${p.salePrice !== undefined ? ' (' + fmtNum(p.salePrice) + ')' : ''}`, placeholder: 'ابحث عن منتج (اسم/رمز/باركود) لإضافته', onPick: (p) => { add(p); } });
  const el = h('div', {}, pick.el, h('div', { class: 'tbl-wrap' }, h('table', { class: 'lines' },
    h('thead', {}, h('tr', {}, h('th', {}, 'المنتج'), h('th', {}, kind === 'delta' ? 'الفرق (+/−)' : 'الكمية'), kind === 'purchase' ? h('th', {}, 'بونص') : null, kind === 'purchase' ? h('th', {}, 'تكلفة الوحدة') : null, kind === 'sale' || kind === 'purchase' ? h('th', {}, kind === 'sale' ? 'خصم %' : 'خصم (مبلغ)') : null, h('th', {}, ''))), body)));
  return {
    el,
    getLines() {
      return rows.map((r) => (kind === 'sale'
        ? { productId: r.product.id, quantity: r.qty, ...(r.disc > 0 ? { discountType: 'Percent', discountValue: r.disc } : {}) }
        : kind === 'qty' ? { productId: r.product.id, quantity: r.qty }
        : kind === 'delta' ? { productId: r.product.id, quantityDelta: r.qty }
        : { productId: r.product.id, quantity: r.qty, bonusQuantity: r.bonus || 0, unitCost: r.cost, discountAmount: r.disc || 0 }));
    },
    validate() {
      if (!rows.length) return 'أضف منتجاً واحداً على الأقل';
      if (kind === 'delta') { if (rows.some((r) => !Number.isInteger(r.qty) || r.qty === 0)) return 'الفرق يجب أن يكون عدداً صحيحاً غير صفري'; return ''; }
      if (rows.some((r) => !Number.isInteger(r.qty) || r.qty < 1)) return 'الكمية يجب أن تكون عدداً صحيحاً موجباً';
      return '';
    },
  };
}

// Operation forms: visit, order, payment, return. Each one only validates and then QUEUES the operation (outbox); the sync engine sends it.
import { api } from '../api.js';
import { dbAll, dbGet } from '../db.js';
import { UserError, badge, errText, errorBox, field, fmtDate, fmtNum, h, normalizeSearch, put, spinner, todayLocal, toast } from '../dom.js';
import { creditForReturn, previewLine, priceBook, requiredBonus } from '../pricing.js';
import { can } from '../session.js';
import { enqueue } from '../sync.js';

async function pickCustomer(ctx) {
  const id = ctx.query.customerId;
  const c = id ? await dbGet('customers', id) : null;
  if (!c) { ctx.root.append(h('div', { class: 'errbox' }, 'اختر عميلاً من قائمة العملاء أولاً.'), h('a', { class: 'btn', href: '#/customers' }, 'العملاء')); return null; }
  return c;
}
const setting = async (key, dflt) => { const r = await dbGet('settings', key); return r ? r.value : dflt; };
const done = (ctx, msg, customerId) => { toast(msg, 'ok'); ctx.navigate('/customers/' + customerId); };
const guard = (ctx, perm) => { if (!can(perm)) { ctx.root.append(h('div', { class: 'errbox' }, 'ليست لديك صلاحية هذه العملية.')); return false; } return true; };
const iso = (d = new Date()) => d.toISOString();

// ───────────── visit
const VISIT_TYPES = { Sales: 'مبيعات', Medical: 'علمية/طبية', FollowUp: 'متابعة', Collection: 'تحصيل', Other: 'أخرى' };
export const haversine = (la1, lo1, la2, lo2) => {
  const R = 6371000, rad = (x) => (x * Math.PI) / 180;
  const a = Math.sin(rad(la2 - la1) / 2) ** 2 + Math.cos(rad(la1)) * Math.cos(rad(la2)) * Math.sin(rad(lo2 - lo1) / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(a));
};
const getFix = () => new Promise((resolve, reject) => {
  if (!navigator.geolocation) return reject(new UserError('هذا الجهاز لا يدعم تحديد الموقع'));
  navigator.geolocation.getCurrentPosition((p) => resolve({ latitude: p.coords.latitude, longitude: p.coords.longitude, accuracyM: Math.round(p.coords.accuracy), locationAt: iso(new Date(p.timestamp)) }),
    (e) => reject(new UserError(e.code === 1 ? 'لم تسمح بالوصول إلى الموقع. فعّله من إعدادات المتصفح.' : 'تعذّر تحديد الموقع، حاول في مكان مكشوف.')), { enableHighAccuracy: true, timeout: 25_000, maximumAge: 0 });
});

export async function visit(ctx) {
  if (!guard(ctx, 'visits.create')) return;
  const c = await pickCustomer(ctx); if (!c) return;
  const startedAt = iso();
  const [needLoc, maxAcc, maxDist] = await Promise.all([setting('require_location_for_visit', false), setting('visit_max_accuracy_m', 100), setting('visit_max_distance_m', 300)]);
  let fix = null;
  const type = h('select', { 'aria-label': 'نوع الزيارة' }, Object.entries(VISIT_TYPES).map(([v, l]) => h('option', { value: v }, l)));
  const outcome = h('input', { 'aria-label': 'النتيجة', maxlength: 500, placeholder: 'مثال: وعد بطلب الأسبوع القادم' });
  const notes = h('textarea', { 'aria-label': 'ملاحظات', maxlength: 2000 });
  const next = h('input', { type: 'date', 'aria-label': 'الزيارة القادمة', min: todayLocal() });
  const locBox = h('div', { class: 'note', 'aria-live': 'polite' }, needLoc === true ? 'الموقع مطلوب لتسجيل الزيارة.' : 'الموقع اختياري لكنه يُثبت الزيارة.');
  const err = h('div');
  const locBtn = h('button', { class: 'btn sec', type: 'button', onclick: async () => {
    locBtn.disabled = true; locBox.textContent = 'جارٍ تحديد الموقع…';
    try {
      fix = await getFix();
      const d = c.latitude != null ? Math.round(haversine(fix.latitude, fix.longitude, c.latitude, c.longitude)) : null;
      const bits = [`الدقة ±${fix.accuracyM} م`];
      if (d !== null) bits.push(`البعد عن العميل ${fmtNum(d)} م`);
      const warn = fix.accuracyM > maxAcc ? ' — الدقة ضعيفة، لن تُعدّ موقعاً مؤكَّداً' : d !== null && d > maxDist ? ' — بعيد عن العميل' : '';
      put(locBox, '✓ تم التقاط الموقع: ' + bits.join(' · ') + warn);
    } catch (e) { fix = null; locBox.textContent = errText(e); }
    locBtn.disabled = false;
  } }, 'التقاط موقعي');
  const save = h('button', { class: 'btn big', type: 'button', onclick: async () => {
    err.replaceChildren();
    try {
      if (needLoc === true && !fix) throw new UserError('التقط موقعك أولاً: الموقع مطلوب لتسجيل الزيارة');
      const payload = { customerId: c.id, startTime: startedAt, endTime: iso(), visitType: type.value };
      if (outcome.value.trim()) payload.outcome = outcome.value.trim();
      if (notes.value.trim()) payload.notes = notes.value.trim();
      if (next.value) payload.nextVisitDate = next.value;
      if (fix) Object.assign(payload, fix);
      save.disabled = true;
      await enqueue('visit', payload, { summary: `زيارة — ${c.name}`, customerId: c.id });
      done(ctx, 'حُفظت الزيارة وستُرسل تلقائياً', c.id);
    } catch (e) { err.replaceChildren(errorBox(e)); save.disabled = false; }
  } }, 'حفظ الزيارة');
  ctx.root.append(h('h2', {}, 'زيارة: ' + c.name), err, h('div', { class: 'card form' }, field('نوع الزيارة', type), field('النتيجة', outcome), field('ملاحظات', notes), field('الزيارة القادمة', next), locBtn, locBox), save);
}

// ───────────── order
export async function order(ctx) {
  if (!guard(ctx, 'orders.create')) return;
  const c = await pickCustomer(ctx); if (!c) return;
  if (c.status !== 'Active') { ctx.root.append(h('div', { class: 'errbox' }, 'العميل غير فعّال؛ لا يمكن إنشاء طلب له.')); return; }
  const [products, lists, listItems, rules] = await Promise.all([dbAll('products'), dbAll('priceLists'), dbAll('priceListItems'), dbAll('bonusRules')]);
  const book = priceBook({ priceLists: lists, priceListItems: listItems, bonusRules: rules }, todayLocal());
  const showPrice = can('products.view_prices');
  const lines = []; // {product, qty}
  const found = h('div', { class: 'cards' });
  const body = h('div', { class: 'cards' });
  const totalBox = h('div', { class: 'card total' });
  const search = h('input', { type: 'search', placeholder: 'ابحث عن منتج: اسم أو رمز أو باركود', 'aria-label': 'بحث عن منتج', oninput: () => drawFound() });
  const notes = h('input', { 'aria-label': 'ملاحظات الطلب', maxlength: 1000, placeholder: 'ملاحظات (اختياري)' });
  const submit = h('input', { type: 'checkbox', checked: true, id: 'submit-chk' });
  const err = h('div');

  const drawFound = () => {
    const q = normalizeSearch(search.value);
    if (q.length < 1) { found.replaceChildren(); return; }
    const rows = products.filter((p) => p.isActive && normalizeSearch(`${p.nameAr} ${p.nameEn || ''} ${p.genericName || ''} ${p.sku} ${p.barcode || ''}`).includes(q)).slice(0, 12);
    put(found, rows.length ? rows.map((p) => h('button', { class: 'card item pick', type: 'button', onclick: () => { add(p); search.value = ''; found.replaceChildren(); } }, h('div', { class: 'grow' }, h('strong', {}, p.nameAr), h('div', { class: 'note' }, p.sku)), showPrice && book.priceOf(p, c).price !== null ? h('div', { class: 'bal' }, fmtNum(book.priceOf(p, c).price)) : null)) : h('div', { class: 'empty' }, 'لا نتائج'));
  };
  const add = (p) => { const l = lines.find((x) => x.product.id === p.id); if (l) l.qty += 1; else lines.push({ product: p, qty: 1 }); draw(); };
  const draw = () => {
    let total = 0; let priced = true;
    put(body, lines.map((l, i) => {
      const r = previewLine(book, l.product, c, l.qty);
      if (r.gross === null) priced = false; else total += r.gross;
      return h('div', { class: 'card line' },
        h('div', { class: 'grow' }, h('strong', {}, l.product.nameAr), h('div', { class: 'note' }, showPrice && r.price !== null ? `${fmtNum(r.price)} × ${l.qty} = ${fmtNum(r.gross)}` : l.product.sku), r.bonus > 0 ? h('div', { class: 'bonus' }, `+ ${r.bonus} بونص`) : null),
        h('div', { class: 'qty' }, h('button', { class: 'btn sec sm', type: 'button', 'aria-label': 'أنقص', onclick: () => { l.qty = Math.max(1, l.qty - 1); draw(); } }, '−'),
          h('input', { type: 'number', min: 1, max: 100000, inputmode: 'numeric', value: l.qty, 'aria-label': 'الكمية', onchange: (e) => { l.qty = Math.floor(Number(e.target.value)) || 1; draw(); } }),
          h('button', { class: 'btn sec sm', type: 'button', 'aria-label': 'زِد', onclick: () => { l.qty += 1; draw(); } }, '+')),
        h('button', { class: 'btn sec sm', type: 'button', 'aria-label': 'حذف', onclick: () => { lines.splice(i, 1); draw(); } }, '✕'));
    }));
    put(totalBox, lines.length ? [h('div', {}, `${lines.length} صنف`), showPrice ? h('div', {}, h('strong', {}, `الإجمالي التقديري: ${fmtNum(total)}${priced ? '' : '+'}`), h('div', { class: 'note' }, 'يحسب الخادم السعر النهائي والبونص والضريبة عند الاستلام.')) : null] : h('div', { class: 'note' }, 'أضف منتجات للطلب.'));
  };
  const save = h('button', { class: 'btn big', type: 'button', onclick: async () => {
    err.replaceChildren();
    try {
      if (!lines.length) throw new UserError('أضف منتجاً واحداً على الأقل');
      if (lines.some((l) => !Number.isInteger(l.qty) || l.qty < 1 || l.qty > 100000)) throw new UserError('الكمية عدد صحيح من 1 إلى 100000');
      const payload = { customerId: c.id, lines: lines.map((l) => ({ productId: l.product.id, quantity: l.qty })), submit: submit.checked };
      if (notes.value.trim()) payload.notes = notes.value.trim();
      save.disabled = true;
      await enqueue('order', payload, { summary: `طلب — ${c.name} (${lines.length} صنف)`, customerId: c.id });
      done(ctx, 'حُفظ الطلب وسيُرسل تلقائياً', c.id);
    } catch (e) { err.replaceChildren(errorBox(e)); save.disabled = false; }
  } }, 'حفظ الطلب');
  ctx.root.append(h('h2', {}, 'طلب: ' + c.name), h('div', { class: 'searchbar' }, search), found, body, totalBox, h('div', { class: 'card form' }, field('ملاحظات', notes), h('label', { class: 'chk' }, submit, ' إرسال للاعتماد مباشرة (وإلا يبقى مسودة)')), err, save);
  draw();
}

// ───────────── payment
const METHODS = { Cash: 'نقد', Bank: 'بنك', Transfer: 'حوالة', Other: 'أخرى' };
export async function payment(ctx) {
  if (!guard(ctx, 'payments.create')) return;
  const c = await pickCustomer(ctx); if (!c) return;
  const open = (await dbAll('openInvoices')).filter((i) => i.customerId === c.id).sort((a, b) => String(a.invoiceDate).localeCompare(String(b.invoiceDate)));
  const totalOpen = open.reduce((a, i) => a + i.remainingAmount, 0);
  const amount = h('input', { type: 'number', min: 1, inputmode: 'numeric', 'aria-label': 'المبلغ', placeholder: 'المبلغ المستلَم' });
  const method = h('select', { 'aria-label': 'طريقة الدفع' }, Object.entries(METHODS).map(([v, l]) => h('option', { value: v }, l)));
  const inv = h('select', { 'aria-label': 'الفاتورة' }, h('option', { value: '' }, 'الأقدم أولاً (توزيع تلقائي)'), open.map((i) => h('option', { value: i.id }, `${i.invoiceNumber} — متبقٍ ${fmtNum(i.remainingAmount)}`)));
  if (ctx.query.invoiceId && open.some((i) => i.id === ctx.query.invoiceId)) inv.value = ctx.query.invoiceId;
  const ref = h('input', { 'aria-label': 'رقم المرجع', maxlength: 100, placeholder: 'رقم الحوالة/الوصل (اختياري)' });
  const notes = h('input', { 'aria-label': 'ملاحظات', maxlength: 1000, placeholder: 'ملاحظات (اختياري)' });
  const hint = h('div', { class: 'note' });
  const err = h('div');
  const upd = () => { const a = Number(amount.value); const sel = open.find((i) => i.id === inv.value); const cap = sel ? sel.remainingAmount : totalOpen; hint.textContent = a > cap && cap >= 0 ? `المبلغ أكبر من المتبقي (${fmtNum(cap)}): الزيادة تُسجَّل رصيداً دائناً للعميل.` : ''; };
  amount.addEventListener('input', upd); inv.addEventListener('change', upd);
  const save = h('button', { class: 'btn big', type: 'button', onclick: async () => {
    err.replaceChildren();
    try {
      const a = Number(amount.value);
      if (!Number.isInteger(a) || a < 1 || a > 2_000_000_000) throw new UserError('المبلغ عدد صحيح موجب (دينار)');
      const payload = { customerId: c.id, amount: a, method: method.value, paymentDate: iso() };
      if (inv.value) payload.invoiceId = inv.value;
      if (ref.value.trim()) payload.referenceNumber = ref.value.trim();
      if (notes.value.trim()) payload.notes = notes.value.trim();
      save.disabled = true;
      await enqueue('payment', payload, { summary: `تسديد ${fmtNum(a)} — ${c.name}`, customerId: c.id });
      done(ctx, 'حُفظ التسديد وسيُرسل تلقائياً', c.id);
    } catch (e) { err.replaceChildren(errorBox(e)); save.disabled = false; }
  } }, 'حفظ التسديد');
  ctx.root.append(h('h2', {}, 'تسديد: ' + c.name), h('div', { class: 'card' }, `المتبقي على فواتيره المفتوحة (آخر مزامنة): ${fmtNum(totalOpen)}`),
    h('div', { class: 'card form' }, field('المبلغ (دينار)', amount), field('طريقة الدفع', method), field('الفاتورة', inv), field('المرجع', ref), field('ملاحظات', notes), hint), err, save);
}

// ───────────── return (needs the invoice's lines, so choosing the invoice needs a connection; saving does not)
const CONDITION = { Valid: 'سليم', Damaged: 'تالف', Expired: 'منتهٍ' };
export async function ret(ctx) {
  if (!guard(ctx, 'returns.create')) return;
  const c = await pickCustomer(ctx); if (!c) return;
  const policy = await setting('bonus_return_policy', 'Proportional');
  const body = h('div', {});
  ctx.root.append(h('h2', {}, 'مردود: ' + c.name), body);
  if (ctx.query.invoiceId) return showInvoice(ctx.query.invoiceId);
  put(body, spinner());
  try {
    const { data } = await api('GET', '/invoices', { query: { customerId: c.id, status: 'Confirmed', pageSize: 50 } });
    put(body, data.length ? h('div', { class: 'cards' }, data.map((i) => h('button', { class: 'card item pick', type: 'button', onclick: () => showInvoice(i.id) }, h('div', { class: 'grow' }, h('strong', {}, i.invoiceNumber), h('div', { class: 'note' }, fmtDate(i.invoiceDate))), h('div', { class: 'bal' }, fmtNum(i.netTotal))))) : h('div', { class: 'empty' }, 'لا فواتير مؤكدة لهذا العميل'));
  } catch (e) { put(body, errorBox(e.network ? { message: 'اختيار الفاتورة للمردود يحتاج اتصالاً بالخادم. اتصل بالشبكة ثم أعد المحاولة.' } : e)); }

  async function showInvoice(id) {
    put(body, spinner());
    try {
      const { data: inv } = await api('GET', `/invoices/${id}`);
      if (inv.status !== 'Confirmed') throw new UserError('الفاتورة ملغاة');
      const rows = inv.items.map((it) => ({
        it, tiers: Array.isArray(it.bonusRuleSnapshot) ? it.bonusRuleSnapshot : [],
        sold: h('input', { type: 'number', min: 0, max: it.quantity - it.returnedQuantity, value: 0, inputmode: 'numeric', 'aria-label': 'كمية مباعة مرتجعة' }),
        bonus: h('input', { type: 'number', min: 0, max: it.bonusQuantity - it.bonusReturnedQuantity, value: 0, inputmode: 'numeric', 'aria-label': 'بونص مرتجع' }),
        cond: h('select', { 'aria-label': 'الحالة' }, Object.entries(CONDITION).map(([v, l]) => h('option', { value: v }, l))), info: h('div', { class: 'note' }),
      }));
      const refresh = () => rows.forEach((r) => {
        const q = Math.max(0, Math.min(Number(r.sold.value) || 0, r.it.quantity - r.it.returnedQuantity));
        const need = requiredBonus(policy, { quantity: r.it.quantity, bonusQuantity: r.it.bonusQuantity, returnedQuantity: r.it.returnedQuantity, bonusReturnedQuantity: r.it.bonusReturnedQuantity, tiers: r.tiers }, q);
        const credit = q > 0 ? creditForReturn(r.it.lineTotal, r.it.quantity, r.it.returnedQuantity, q) : 0;
        r.info.textContent = q > 0 ? `تقدير: قيمة المردود ${fmtNum(credit)}${need > 0 ? ` — البونص المطلوب إرجاعه: ${need}` : ''}` : '';
      });
      rows.forEach((r) => { r.sold.addEventListener('input', refresh); r.bonus.addEventListener('input', refresh); });
      const reason = h('input', { 'aria-label': 'سبب المردود', maxlength: 300, placeholder: 'سبب المردود' });
      const err = h('div');
      const save = h('button', { class: 'btn big', type: 'button', onclick: async () => {
        err.replaceChildren();
        try {
          const items = rows.map((r) => ({ invoiceItemId: r.it.id, soldQuantity: Math.floor(Number(r.sold.value)) || 0, bonusQuantity: Math.floor(Number(r.bonus.value)) || 0, condition: r.cond.value })).filter((i) => i.soldQuantity > 0 || i.bonusQuantity > 0);
          if (!items.length) throw new UserError('أدخل كمية مرتجعة لصنف واحد على الأقل');
          const payload = { invoiceId: id, items };
          if (reason.value.trim()) payload.reason = reason.value.trim();
          save.disabled = true;
          await enqueue('return', payload, { summary: `مردود على ${inv.invoiceNumber} — ${c.name}`, customerId: c.id });
          done(ctx, 'حُفظ المردود وسيُرسل تلقائياً', c.id);
        } catch (e) { err.replaceChildren(errorBox(e)); save.disabled = false; }
      } }, 'حفظ المردود');
      put(body, h('div', { class: 'card' }, h('strong', {}, 'الفاتورة ' + inv.invoiceNumber), ' ', badge('سياسة البونص: ' + policy)),
        h('div', { class: 'cards' }, rows.map((r) => h('div', { class: 'card form' }, h('strong', {}, r.it.product ? r.it.product.nameAr : ''), h('div', { class: 'note' }, `مباع ${r.it.quantity} (مرتجع سابقاً ${r.it.returnedQuantity}) · بونص ${r.it.bonusQuantity}`),
          field('كمية مباعة مرتجعة', r.sold), field('بونص مرتجع (طوعي)', r.bonus), field('الحالة', r.cond), r.info))),
        h('div', { class: 'card form' }, field('السبب', reason)), h('p', { class: 'note' }, 'التقدير للمساعدة فقط؛ الخادم يطبّق السياسة وقد يطلب إرجاع بونص تلقائياً.'), err, save);
    } catch (e) { put(body, errorBox(e)); }
  }
}

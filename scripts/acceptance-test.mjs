#!/usr/bin/env node
/**
 * End-to-end acceptance test: SRS §116 (the 28 acceptance criteria) + integrity and concurrency checks.
 * Needs Node 18+ and a RUNNING API on a TEST database (it creates data and has no cleanup: money records are never deleted).
 *
 *   API_URL=http://localhost:3000/api/v1 ADMIN_USER=admin ADMIN_PASSWORD='...' node scripts/acceptance-test.mjs
 *
 * Exit code 0 only if every check passes. Failures print the HTTP status and response body.
 */
const BASE = (process.env.API_URL ?? 'http://localhost:3000/api/v1').replace(/\/$/, '');
const ADMIN_USER = process.env.ADMIN_USER ?? 'admin';
const ADMIN_PASSWORD = process.env.ADMIN_PASSWORD ?? '';
const SUFFIX = Date.now().toString(36);
const REP_PASSWORD = 'Rep#Pass-' + SUFFIX + '!';
const DEVICE = 'acceptance-device-' + SUFFIX;

const results = [];
const S = {}; // shared state between steps

// ───────── helpers ─────────
async function api(method, path, { token, body, headers = {}, device } = {}) {
  const h = { 'content-type': 'application/json', ...headers };
  if (token) h.authorization = `Bearer ${token}`;
  if (device) h['x-device-id'] = device;
  const res = await fetch(BASE + path, { method, headers: h, body: body === undefined ? undefined : JSON.stringify(body) });
  const text = await res.text();
  let json;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text.slice(0, 300) }; }
  return { status: res.status, body: json, data: json?.data, code: json?.code };
}
const snippet = (r) => `HTTP ${r.status} ${JSON.stringify(r.body).slice(0, 350)}`;
function expectStatus(r, ...ok) { if (!ok.includes(r.status)) throw new Error(`expected ${ok.join('/')} but got ${snippet(r)}`); return r; }
function eq(actual, expected, what) { if (actual !== expected) throw new Error(`${what}: expected ${expected}, got ${actual}`); }
function truthy(v, what) { if (!v) throw new Error(`${what}: missing`); return v; }
const need = (v, what) => truthy(v, `prerequisite "${what}" (an earlier step failed)`);
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());
const plusDays = (n) => new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);

async function step(id, name, fn) {
  try {
    await fn();
    results.push({ id, name, ok: true });
    console.log(`  PASS  ${id}  ${name}`);
  } catch (e) {
    results.push({ id, name, ok: false, detail: e.message });
    console.log(`  FAIL  ${id}  ${name}\n          ${e.message}`);
  }
}
const stockOf = async (productId, warehouseId) => {
  const r = expectStatus(await api('GET', `/stock?productId=${productId}&warehouseId=${warehouseId}`, { token: S.admin }), 200);
  return r.data?.[0]?.quantity ?? 0;
};

// ═════════════════════ SRS §116 acceptance criteria ═════════════════════
console.log(`\nAcceptance test against ${BASE}  (run ${SUFFIX})\n`);
console.log('— SRS §116 —');

await step('00', 'API is healthy', async () => {
  expectStatus(await api('GET', '/health'), 200);
});

await step('01', 'User logs in', async () => {
  truthy(ADMIN_PASSWORD, 'ADMIN_PASSWORD env var');
  const r = expectStatus(await api('POST', '/auth/login', { body: { identifier: ADMIN_USER, password: ADMIN_PASSWORD } }), 200);
  S.admin = truthy(r.data?.accessToken, 'accessToken');
  const me = expectStatus(await api('GET', '/auth/me', { token: S.admin }), 200);
  eq(me.data.username, ADMIN_USER.toLowerCase(), 'me.username');
});

await step('02', 'Admin creates a representative', async () => {
  const roles = expectStatus(await api('GET', '/roles', { token: need(S.admin, 'admin token') }), 200);
  const role = truthy(roles.data.find((x) => x.name === 'representative'), 'role "representative" (run the seed)');
  const u = expectStatus(await api('POST', '/users', { token: S.admin, body: { username: 'rep_' + SUFFIX, fullName: 'مندوب اختبار ' + SUFFIX, password: REP_PASSWORD, roleId: role.id } }), 201);
  S.repUserId = u.data.id;
  const rep = expectStatus(await api('POST', '/representatives', { token: S.admin, body: { fullName: 'مندوب اختبار ' + SUFFIX, userId: S.repUserId } }), 201);
  S.repId = truthy(rep.data.id, 'representative id');
});

await step('03', 'Admin creates an area', async () => {
  const r = expectStatus(await api('POST', '/areas', { token: need(S.admin, 'admin token'), body: { name: 'منطقة ' + SUFFIX, city: 'بغداد' } }), 201);
  S.areaId = r.data.id;
});

await step('04', 'Area is linked to the representative', async () => {
  expectStatus(await api('POST', `/areas/${need(S.areaId, 'area')}/assign`, { token: S.admin, body: { representativeId: need(S.repId, 'rep') } }), 201);
  const a = expectStatus(await api('GET', `/areas/${S.areaId}`, { token: S.admin }), 200);
  eq(a.data.responsible?.id, S.repId, 'area.responsible.id');
});

await step('05', 'Admin adds a pharmacy', async () => {
  const r = expectStatus(await api('POST', '/customers', { token: need(S.admin, 'admin token'), body: { name: 'صيدلية اختبار ' + SUFFIX, customerType: 'Pharmacy', areaId: need(S.areaId, 'area'), phone: '07701234567' } }), 201);
  S.customerId = r.data.id;
  const other = expectStatus(await api('POST', '/customers', { token: S.admin, body: { name: 'صيدلية غير مسندة ' + SUFFIX, customerType: 'Pharmacy' } }), 201);
  S.otherCustomerId = other.data.id;
});

await step('06', 'Pharmacy is linked to the representative', async () => {
  expectStatus(await api('POST', `/customers/${need(S.customerId, 'customer')}/assign`, { token: S.admin, body: { representativeId: need(S.repId, 'rep') } }), 201);
  const c = expectStatus(await api('GET', `/customers/${S.customerId}`, { token: S.admin }), 200);
  eq(c.data.assignedRepresentative?.id, S.repId, 'customer.assignedRepresentative.id');
});

await step('07', 'Admin adds a medicine', async () => {
  const t = need(S.admin, 'admin token');
  const co = expectStatus(await api('POST', '/companies', { token: t, body: { name: 'شركة ' + SUFFIX } }), 201);
  const cat = expectStatus(await api('POST', '/categories', { token: t, body: { name: 'تصنيف ' + SUFFIX } }), 201);
  S.companyId = co.data.id;
  S.categoryId = cat.data.id;
  const p = expectStatus(await api('POST', '/products', { token: t, body: { nameAr: 'دواء اختبار ' + SUFFIX, companyId: S.companyId, categoryId: S.categoryId, salePrice: 12000, minSalePrice: 9000, purchasePrice: 6000, reorderLevel: 5 } }), 201);
  S.productId = p.data.id;
  expectStatus(await api('POST', '/bonus-rules', { token: t, body: { productId: S.productId, minQuantity: 10, bonusQuantity: 2 } }), 201); // "every 10 + 2"
});

await step('08', 'Admin adds a price (price list)', async () => {
  const t = need(S.admin, 'admin token');
  const pl = expectStatus(await api('POST', '/price-lists', { token: t, body: { name: 'قائمة ' + SUFFIX } }), 201);
  S.priceListId = pl.data.id;
  expectStatus(await api('PUT', `/price-lists/${S.priceListId}/items`, { token: t, body: { items: [{ productId: need(S.productId, 'product'), price: 10000 }] } }), 200);
  expectStatus(await api('PATCH', `/customers/${need(S.customerId, 'customer')}`, { token: t, body: { priceListId: S.priceListId } }), 200);
  const r = expectStatus(await api('GET', `/price-lists/resolve?productId=${S.productId}&priceListId=${S.priceListId}`, { token: t }), 200);
  eq(r.data.price, 10000, 'resolved price');
});

await step('09', 'Admin adds stock (purchase received in two batches)', async () => {
  const t = need(S.admin, 'admin token');
  const w = expectStatus(await api('POST', '/warehouses', { token: t, body: { name: 'مخزن ' + SUFFIX } }), 201);
  S.warehouseId = w.data.id;
  const po = expectStatus(await api('POST', '/purchases', { token: t, body: { companyId: need(S.companyId, 'company'), warehouseId: S.warehouseId, items: [{ productId: need(S.productId, 'product'), quantity: 100, unitCost: 6000 }] } }), 201);
  expectStatus(await api('POST', `/purchases/${po.data.id}/order`, { token: t }), 200);
  const itemId = po.data.items[0].id;
  expectStatus(await api('POST', `/purchases/${po.data.id}/receive`, { token: t, body: { lines: [
    { itemId, batchNumber: 'B1-' + SUFFIX, expiryDate: plusDays(180), quantity: 40 },
    { itemId, batchNumber: 'B2-' + SUFFIX, expiryDate: plusDays(540), quantity: 60 },
  ] } }), 200);
  eq(await stockOf(S.productId, S.warehouseId), 100, 'stock after purchase');
});

await step('10', 'Representative sees only his own customer', async () => {
  const login = expectStatus(await api('POST', '/auth/login', { body: { identifier: 'rep_' + SUFFIX, password: REP_PASSWORD, device: { deviceId: DEVICE, platform: 'android', appVersion: '1.0.0' } } }), 200);
  S.rep = truthy(login.data.accessToken, 'rep token');
  const list = expectStatus(await api('GET', '/customers?pageSize=100', { token: S.rep }), 200);
  const ids = list.data.map((c) => c.id);
  if (!ids.includes(need(S.customerId, 'customer'))) throw new Error('assigned customer is missing from the rep list');
  if (ids.includes(need(S.otherCustomerId, 'other customer'))) throw new Error('rep can see a customer assigned to nobody');
  expectStatus(await api('GET', `/customers/${S.otherCustomerId}`, { token: S.rep }), 404);
});

await step('11', 'Representative records a visit', async () => {
  const r = expectStatus(await api('POST', '/visits', { token: need(S.rep, 'rep token'), body: { customerId: need(S.customerId, 'customer'), startTime: new Date().toISOString(), visitType: 'Sales' } }), 201);
  S.visitId = r.data.id;
});

await step('12', 'Representative creates an order', async () => {
  const r = expectStatus(await api('POST', '/orders', { token: need(S.rep, 'rep token'), body: { customerId: need(S.customerId, 'customer'), submit: true, lines: [{ productId: need(S.productId, 'product'), quantity: 10 }] } }), 201);
  S.orderId = r.data.id;
  eq(r.data.status, 'Submitted', 'order status');
  eq(r.data.items[0].unitPrice, 10000, 'unit price comes from the price list, not from the rep');
});

await step('13', 'System computes the discount', async () => {
  // a user allowed to discount (admin) edits the order: 10% of 100,000
  const r = expectStatus(await api('PATCH', `/orders/${need(S.orderId, 'order')}`, { token: need(S.admin, 'admin token'), body: { lines: [{ productId: S.productId, quantity: 10, discountType: 'Percent', discountValue: 10 }] } }), 200);
  eq(r.data.discountTotal, 10000, 'discountTotal');
  eq(r.data.total, 90000, 'order total');
  // and the rep alone cannot discount
  const bad = await api('POST', '/orders', { token: S.rep, body: { customerId: S.customerId, lines: [{ productId: S.productId, quantity: 1, discountType: 'Percent', discountValue: 50 }] } });
  expectStatus(bad, 403);
});

await step('14', 'System computes the bonus', async () => {
  const o = expectStatus(await api('GET', `/orders/${need(S.orderId, 'order')}`, { token: need(S.admin, 'admin token') }), 200);
  eq(o.data.items[0].bonusQuantity, 2, 'bonus for 10 units (every 10 + 2)');
});

await step('15', 'Management approves the order', async () => {
  const r = expectStatus(await api('POST', `/orders/${need(S.orderId, 'order')}/approve`, { token: need(S.admin, 'admin token') }), 200);
  eq(r.data.status, 'Approved', 'status');
});

await step('16', 'System creates the invoice', async () => {
  const r = expectStatus(await api('POST', `/orders/${need(S.orderId, 'order')}/convert-to-invoice`, { token: need(S.admin, 'admin token'), body: { warehouseId: need(S.warehouseId, 'warehouse') } }), 201);
  S.invoiceId = r.data.id;
  S.invoiceItemId = r.data.items[0].id;
  eq(r.data.netTotal, 90000, 'invoice netTotal');
  eq(r.data.status, 'Confirmed', 'invoice status');
  eq(r.data.items[0].bonusQuantity, 2, 'invoice bonus');
});

await step('17', 'System decreases stock (12 units, FEFO from the earliest batch)', async () => {
  eq(await stockOf(need(S.productId, 'product'), need(S.warehouseId, 'warehouse')), 88, 'stock');
  const b = expectStatus(await api('GET', `/inventory/batches?productId=${S.productId}`, { token: S.admin }), 200);
  const b1 = b.data.find((x) => x.batchNumber === 'B1-' + SUFFIX);
  const b2 = b.data.find((x) => x.batchNumber === 'B2-' + SUFFIX);
  eq(b1?.quantity, 28, 'batch 1 (earliest expiry) quantity');
  eq(b2?.quantity, 60, 'batch 2 untouched');
});

await step('18', 'Customer debt increases', async () => {
  const r = expectStatus(await api('GET', `/customers/${need(S.customerId, 'customer')}/balance`, { token: need(S.admin, 'admin token') }), 200);
  eq(r.data.balance, 90000, 'balance');
});

await step('19', 'A payment is recorded', async () => {
  const r = expectStatus(await api('POST', '/payments', { token: need(S.admin, 'admin token'), body: { customerId: need(S.customerId, 'customer'), amount: 50000, method: 'Cash' } }), 201);
  S.pay1 = r.data.id;
  eq(r.data.allocatedAmount, 50000, 'allocated to the invoice');
});

await step('20', 'Balance updates after the payment', async () => {
  const r = expectStatus(await api('GET', `/customers/${need(S.customerId, 'customer')}/balance`, { token: need(S.admin, 'admin token') }), 200);
  eq(r.data.balance, 40000, 'balance');
});

await step('21', 'A return is created (Proportional bonus policy)', async () => {
  const st = expectStatus(await api('PUT', '/settings/bonus_return_policy', { token: need(S.admin, 'admin token'), body: { value: 'Proportional' } }), 200);
  eq(st.data.value, 'Proportional', 'policy');
  const r = expectStatus(await api('POST', '/returns', { token: S.admin, body: { invoiceId: need(S.invoiceId, 'invoice'), items: [{ invoiceItemId: need(S.invoiceItemId, 'invoice item'), soldQuantity: 2 }] } }), 201);
  S.returnId = r.data.id;
  eq(r.data.creditAmount, 18000, 'credit uses the discounted price (2 x 9,000)');
  const bonus = r.data.items.find((i) => i.lineType === 'Bonus');
  eq(bonus?.quantity, 2, 'the 2 bonus units must come back (remaining 8 sold < 10)');
});

await step('22', 'Stock updates after the return', async () => {
  eq(await stockOf(need(S.productId, 'product'), need(S.warehouseId, 'warehouse')), 92, 'stock (88 + 2 sold + 2 bonus)');
});

await step('23', 'Balance updates after the return', async () => {
  const r = expectStatus(await api('GET', `/customers/${need(S.customerId, 'customer')}/balance`, { token: need(S.admin, 'admin token') }), 200);
  eq(r.data.balance, 22000, 'balance (90,000 - 50,000 - 18,000)');
});

await step('24', 'Reports show the correct data', async () => {
  const t = need(S.admin, 'admin token');
  const q = `from=${today}&to=${today}`;
  const byCust = expectStatus(await api('GET', `/reports/sales/by/customer?${q}&customerId=${need(S.customerId, 'customer')}`, { token: t }), 200);
  eq(byCust.data.rows[0]?.net, 90000, 'sales by customer: net');
  const rec = expectStatus(await api('GET', `/reports/financial/receivables?customerId=${S.customerId}`, { token: t }), 200);
  eq(rec.data.rows[0]?.balance, 22000, 'receivables: customer balance');
  // the same number must come out of different reports
  const daily = expectStatus(await api('GET', `/reports/sales/daily?${q}`, { token: t }), 200);
  const dash = expectStatus(await api('GET', '/dashboard', { token: t }), 200);
  eq(daily.data.totals.net, dash.data.sales.today.amount, 'sales/daily total vs dashboard sales today');
  const rec2 = expectStatus(await api('GET', '/reports/financial/receivables', { token: t }), 200);
  eq(rec2.data.totals.receivable, dash.data.receivables.total, 'receivables report vs dashboard');
  const aging = expectStatus(await api('GET', '/reports/financial/aging', { token: t }), 200);
  const open = expectStatus(await api('GET', '/reports/financial/outstanding-invoices?pageSize=200', { token: t }), 200);
  eq(aging.data.totals.total, open.data.totals.remaining, 'aging total vs outstanding invoices');
  const csv = await fetch(`${BASE}/reports/sales/daily?${q}&format=csv`, { headers: { authorization: `Bearer ${t}` } });
  eq(csv.status, 200, 'csv status');
  if (!(csv.headers.get('content-type') ?? '').includes('text/csv')) throw new Error('csv export has the wrong content-type');
});

await step('25', 'Audit log records the operations', async () => {
  const t = need(S.admin, 'admin token');
  const a = expectStatus(await api('GET', `/audit-logs?entity=invoice&entityId=${need(S.invoiceId, 'invoice')}`, { token: t }), 200);
  if (!a.data.some((x) => x.action === 'invoices.create')) throw new Error('no invoices.create audit entry');
  const b = expectStatus(await api('GET', `/audit-logs?entity=return&entityId=${need(S.returnId, 'return')}`, { token: t }), 200);
  if (!b.data.some((x) => x.action === 'returns.create')) throw new Error('no returns.create audit entry');
});

await step('26', 'An offline order is created on the device, then synced', async () => {
  S.localOrder = crypto.randomUUID();
  const push = expectStatus(await api('POST', '/sync/push', { token: need(S.rep, 'rep token'), device: DEVICE, body: { ops: [{
    localId: S.localOrder, type: 'order', clientCreatedAt: new Date().toISOString(), payload: { customerId: need(S.customerId, 'customer'), submit: true, lines: [{ productId: need(S.productId, 'product'), quantity: 3 }] },
  }] } }), 200);
  S.pushFirst = push.data.results[0];
  eq(S.pushFirst.status, 'Applied', 'push status');
  const orders = expectStatus(await api('GET', `/orders?customerId=${S.customerId}&pageSize=50`, { token: S.rep }), 200);
  if (!orders.data.some((o) => o.id === S.pushFirst.serverId)) throw new Error('synced order is not visible to the rep');
});

await step('27', 'Repeating the sync does not create a duplicate', async () => {
  const before = expectStatus(await api('GET', `/orders?customerId=${need(S.customerId, 'customer')}&pageSize=100`, { token: need(S.rep, 'rep token') }), 200).meta.total;
  const again = expectStatus(await api('POST', '/sync/push', { token: S.rep, device: DEVICE, body: { ops: [{
    localId: need(S.localOrder, 'local order id'), type: 'order', payload: { customerId: S.customerId, submit: true, lines: [{ productId: S.productId, quantity: 3 }] },
  }] } }), 200).data.results[0];
  eq(again.serverId, S.pushFirst.serverId, 'same server id');
  eq(again.duplicate, true, 'duplicate flag');
  const after = expectStatus(await api('GET', `/orders?customerId=${S.customerId}&pageSize=100`, { token: S.rep }), 200).meta.total;
  eq(after, before, 'order count after the repeat');
  // invoices: the same Idempotency-Key twice = one invoice, one stock deduction
  const key = 'idem-' + SUFFIX;
  const stock0 = await stockOf(S.productId, S.warehouseId);
  const body = { customerId: S.customerId, warehouseId: S.warehouseId, lines: [{ productId: S.productId, quantity: 1 }] };
  const a = expectStatus(await api('POST', '/invoices', { token: S.admin, headers: { 'idempotency-key': key }, body }), 201);
  const b = expectStatus(await api('POST', '/invoices', { token: S.admin, headers: { 'idempotency-key': key }, body }), 200, 201);
  eq(b.data.id, a.data.id, 'same invoice for the same Idempotency-Key');
  eq(await stockOf(S.productId, S.warehouseId), stock0 - 1, 'stock deducted once');
  S.idemInvoice = a.data.id;
});

await step('28', 'An unauthorised user cannot reach protected data', async () => {
  expectStatus(await api('GET', '/customers'), 401);
  const rep = need(S.rep, 'rep token');
  expectStatus(await api('GET', '/reports/sales/daily', { token: rep }), 403);
  expectStatus(await api('GET', '/audit-logs', { token: rep }), 403);
  expectStatus(await api('POST', '/invoices', { token: rep, body: { customerId: S.customerId, warehouseId: S.warehouseId, lines: [{ productId: S.productId, quantity: 1 }] } }), 403);
  expectStatus(await api('GET', '/users', { token: rep }), 403);
  const prod = expectStatus(await api('GET', `/products/${need(S.productId, 'product')}`, { token: rep }), 200);
  if ('purchasePrice' in prod.data || 'minSalePrice' in prod.data) throw new Error('the rep can see cost data');
});

// ═════════════════════ integrity & concurrency ═════════════════════
console.log('\n— integrity & concurrency —');

await step('E1', 'Return limits: more than sold, and bonus the customer does not hold', async () => {
  const t = need(S.admin, 'admin token');
  const r1 = await api('POST', '/returns', { token: t, body: { invoiceId: need(S.invoiceId, 'invoice'), items: [{ invoiceItemId: S.invoiceItemId, soldQuantity: 9 }] } });
  expectStatus(r1, 422);
  eq(r1.code, 'SOLD_EXCEEDS_RETURNABLE', 'code');
  const r2 = await api('POST', '/returns', { token: t, body: { invoiceId: S.invoiceId, items: [{ invoiceItemId: S.invoiceItemId, bonusQuantity: 1 }] } });
  expectStatus(r2, 422);
  eq(r2.code, 'BONUS_EXCEEDS_RETURNABLE', 'code');
});

await step('E2', 'Independent bonus return: allowed up to what was given, then refused', async () => {
  const t = need(S.admin, 'admin token');
  const inv = expectStatus(await api('POST', '/invoices', { token: t, body: { customerId: need(S.customerId, 'customer'), warehouseId: need(S.warehouseId, 'warehouse'), lines: [{ productId: need(S.productId, 'product'), quantity: 20 }] } }), 201);
  eq(inv.data.items[0].bonusQuantity, 4, 'bonus for 20 units');
  const item = inv.data.items[0].id;
  const ok = expectStatus(await api('POST', '/returns', { token: t, body: { invoiceId: inv.data.id, items: [{ invoiceItemId: item, bonusQuantity: 4 }] } }), 201);
  eq(ok.data.creditAmount, 0, 'bonus-only return has no money value');
  const bad = await api('POST', '/returns', { token: t, body: { invoiceId: inv.data.id, items: [{ invoiceItemId: item, bonusQuantity: 1 }] } });
  expectStatus(bad, 422);
});

await step('E3', 'Cancelling an invoice restores stock and the customer balance', async () => {
  const t = need(S.admin, 'admin token');
  const id = need(S.idemInvoice, 'idempotent invoice');
  const stock0 = await stockOf(S.productId, S.warehouseId);
  const bal0 = expectStatus(await api('GET', `/customers/${S.customerId}/balance`, { token: t }), 200).data.balance;
  expectStatus(await api('POST', `/invoices/${id}/cancel`, { token: t, body: { reason: 'acceptance test' } }), 200);
  eq(await stockOf(S.productId, S.warehouseId), stock0 + 1, 'stock restored');
  const bal1 = expectStatus(await api('GET', `/customers/${S.customerId}/balance`, { token: t }), 200).data.balance;
  eq(bal1, bal0 - 10000, 'balance reduced by the cancelled invoice');
});

await step('E4', 'Five parallel sales of the last unit: exactly one succeeds, stock never negative', async () => {
  const t = need(S.admin, 'admin token');
  const p = expectStatus(await api('POST', '/products', { token: t, body: { nameAr: 'آخر وحدة ' + SUFFIX, companyId: need(S.companyId, 'company'), salePrice: 5000 } }), 201);
  expectStatus(await api('POST', '/stock/opening', { token: t, body: { warehouseId: need(S.warehouseId, 'warehouse'), productId: p.data.id, quantity: 1 } }), 201);
  const call = () => api('POST', '/invoices', { token: t, body: { customerId: S.customerId, warehouseId: S.warehouseId, lines: [{ productId: p.data.id, quantity: 1 }] } });
  const rs = await Promise.all([call(), call(), call(), call(), call()]);
  const okN = rs.filter((r) => r.status === 201).length;
  const noStock = rs.filter((r) => r.status === 409 && r.code === 'INSUFFICIENT_STOCK').length;
  const bad = rs.filter((r) => r.status >= 500);
  if (bad.length) throw new Error('server error under concurrency: ' + snippet(bad[0]));
  eq(okN, 1, 'successful sales');
  eq(noStock, 4, 'rejected for insufficient stock');
  eq(await stockOf(p.data.id, S.warehouseId), 0, 'stock');
});

await step('E5', 'Four parallel payments never settle more than the invoice owes', async () => {
  const t = need(S.admin, 'admin token');
  const owed = expectStatus(await api('GET', `/customers/${need(S.customerId, 'customer')}/open-invoices`, { token: t }), 200).data;
  const inv = owed.find((i) => i.id === S.invoiceId);
  const remaining = truthy(inv, 'open invoice').remainingAmount;
  const call = () => api('POST', '/payments', { token: t, body: { customerId: S.customerId, invoiceId: S.invoiceId, amount: Math.ceil(remaining / 3), method: 'Cash', autoAllocate: false } });
  const rs = await Promise.all([call(), call(), call(), call()]);
  const bad = rs.filter((r) => r.status >= 500);
  if (bad.length) throw new Error('server error under concurrency: ' + snippet(bad[0]));
  const allocated = rs.filter((r) => r.status === 201).reduce((s, r) => s + r.data.allocatedAmount, 0);
  eq(allocated, remaining, 'total allocated to the invoice (never more than it owed)');
  const after = expectStatus(await api('GET', `/invoices/${S.invoiceId}`, { token: t }), 200).data;
  eq(after.remainingAmount, 0, 'invoice remaining');
  S.parallelPayments = rs.filter((r) => r.status === 201).map((r) => r.data);
});

await step('E6', 'Cancelling a payment re-opens the invoice', async () => {
  const t = need(S.admin, 'admin token');
  const p = truthy(need(S.parallelPayments, 'parallel payments').find((x) => x.allocatedAmount > 0), 'allocated payment');
  expectStatus(await api('POST', `/payments/${p.id}/cancel`, { token: t, body: { reason: 'acceptance test' } }), 200);
  const inv = expectStatus(await api('GET', `/invoices/${S.invoiceId}`, { token: t }), 200).data;
  eq(inv.remainingAmount, p.allocatedAmount, 'invoice remaining after the cancellation');
});

await step('E7', 'The same payment sent twice from a device is recorded once', async () => {
  const localId = crypto.randomUUID();
  const body = { customerId: need(S.customerId, 'customer'), amount: 1000, method: 'Cash', localId };
  const a = expectStatus(await api('POST', '/payments', { token: need(S.admin, 'admin token'), device: DEVICE + '-pay', body }), 201);
  const b = expectStatus(await api('POST', '/payments', { token: S.admin, device: DEVICE + '-pay', body }), 200, 201);
  eq(b.data.id, a.data.id, 'same payment');
});

await step('E8', 'A sync operation that cannot be applied lands in the conflict queue and can be discarded', async () => {
  const t = need(S.admin, 'admin token');
  const localId = crypto.randomUUID();
  const push = expectStatus(await api('POST', '/sync/push', { token: need(S.rep, 'rep token'), device: DEVICE, body: { ops: [{
    localId, type: 'order', payload: { customerId: need(S.otherCustomerId, 'other customer'), lines: [{ productId: need(S.productId, 'product'), quantity: 1 }] }, // not this rep's customer
  }] } }), 200).data.results[0];
  if (!['Conflict', 'Rejected'].includes(push.status)) throw new Error('expected Conflict/Rejected, got ' + JSON.stringify(push));
  const list = expectStatus(await api('GET', '/sync/conflicts?pageSize=100&status=' + push.status, { token: t }), 200);
  const rec = truthy(list.data.find((x) => x.localId === localId), 'operation in the queue');
  const full = expectStatus(await api('GET', `/sync/conflicts/${rec.id}`, { token: t }), 200);
  if (!full.data.payload) throw new Error('the payload must be kept');
  expectStatus(await api('POST', `/sync/conflicts/${rec.id}/resolve`, { token: t, body: { action: 'discard', note: 'acceptance test' } }), 200);
});

await step('E9', 'Delta pull gives the rep his customers, balances and prices (and no cost)', async () => {
  const rep = need(S.rep, 'rep token');
  const c = expectStatus(await api('GET', '/sync/pull/customers', { token: rep }), 200).data;
  if (!c.items.some((x) => x.id === S.customerId)) throw new Error('customer missing from pull');
  if (c.items.some((x) => x.id === S.otherCustomerId)) throw new Error('pull leaked a customer that is not his');
  const b = expectStatus(await api('GET', '/sync/pull/balances', { token: rep }), 200).data;
  if (!b.items.some((x) => x.customerId === S.customerId)) throw new Error('balance missing from pull');
  const p = expectStatus(await api('GET', '/sync/pull/products', { token: rep }), 200).data;
  const prod = p.items.find((x) => x.id === S.productId);
  truthy(prod, 'product in pull');
  if ('purchasePrice' in prod) throw new Error('pull leaked the purchase price');
  const next = expectStatus(await api('GET', `/sync/pull/customers?since=${encodeURIComponent(c.serverTime)}`, { token: rep }), 200).data;
  if (next.items.length > c.items.length) throw new Error('delta returned more than the full download');
});

await step('E10', 'Books reconcile: inventory and money', async () => {
  const t = need(S.admin, 'admin token');
  const inv = expectStatus(await api('GET', '/inventory/reconcile', { token: t }), 200).data;
  if (!inv.ok) throw new Error('inventory reconcile found issues: ' + JSON.stringify(inv.issues).slice(0, 400));
  const acc = expectStatus(await api('GET', '/accounting/reconcile', { token: t }), 200).data;
  if (!acc.ok) throw new Error('accounting reconcile found issues: ' + JSON.stringify(acc).slice(0, 400));
});

// ───────── summary ─────────
const failed = results.filter((r) => !r.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed.`);
if (failed.length) {
  console.log('\nFAILED:');
  for (const f of failed) console.log(`  ${f.id}  ${f.name}\n      ${f.detail}`);
  process.exitCode = 1;
} else {
  console.log('All acceptance criteria and integrity checks passed.');
}

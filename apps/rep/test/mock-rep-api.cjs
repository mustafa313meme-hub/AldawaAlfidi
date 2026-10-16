// In-memory imitation of the sync API (same envelope/shapes) to test the rep app in a real browser. Proves the app, not the real server.
const http = require('http'); const fs = require('fs'); const path = require('path');
const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Baghdad' }).format(new Date());

function startMock(port = 0) {
  const state = { requests: [], applied: new Map(), pushCalls: 0, conflictFor: new Set(), online: true };
  const customers = [
    { id: 'c1', code: 'C-000001', name: 'صيدلية الأمل', customerType: 'Pharmacy', phone: '07701234567', address: 'الكرادة', latitude: 33.3152, longitude: 44.3661, creditLimit: 0, priceListId: 'pl1', status: 'Active', updatedAt: new Date().toISOString() },
    { id: 'c2', code: 'C-000002', name: '<img src=x onerror="window.__xss=1">', customerType: 'Doctor', phone: null, address: null, latitude: null, longitude: null, creditLimit: 0, priceListId: null, status: 'Active', updatedAt: new Date().toISOString() },
    { id: 'c3', code: 'C-000003', name: 'مستشفى محظور', customerType: 'Hospital', status: 'Blocked', updatedAt: new Date().toISOString() },
  ];
  const now = () => new Date().toISOString();
  const entities = {
    customers, removedCustomers: [], categories: [], companies: [], bonusRules: [{ id: 'br1', productId: 'p1', minQuantity: 10, bonusQuantity: 2, isActive: true, startDate: null, endDate: null, customerType: null, updatedAt: now() }],
    products: [
      { id: 'p1', sku: 'P-000001', nameAr: 'بنادول ٥٠٠', barcode: '6221', salePrice: 12000, isActive: true, bonusEligible: true, updatedAt: now() },
      { id: 'p2', sku: 'P-000002', nameAr: 'مرهم اختبار', barcode: null, salePrice: 5000, isActive: true, bonusEligible: true, updatedAt: now() }],
    balances: [{ customerId: 'c1', balance: 22000, updatedAt: now() }],
    priceLists: [{ id: 'pl1', name: 'جملة', isDefault: false, isActive: true, itemCount: 1, updatedAt: now() }],
    priceListItems: [{ priceListId: 'pl1', productId: 'p1', price: 10000, updatedAt: now() }],
    visitPlans: [{ id: 'vp1', planDate: today, customerId: 'c1', priority: 1, plannedOrder: 1, status: 'Planned', visitId: null, updatedAt: now() }, { id: 'vp2', planDate: today, customerId: 'c2', priority: 0, plannedOrder: 2, status: 'Planned', visitId: null, updatedAt: now() }],
    openInvoices: [{ id: 'i1', invoiceNumber: 'INV-000001', customerId: 'c1', invoiceDate: '2026-10-09T08:00:00Z', netTotal: 90000, paidAmount: 50000, returnedAmount: 18000, remainingAmount: 22000, paymentStatus: 'Partial', status: 'Confirmed', updatedAt: now() }],
    settings: [{ key: 'require_location_for_visit', value: false }, { key: 'visit_max_accuracy_m', value: 100 }, { key: 'visit_max_distance_m', value: 300 }, { key: 'bonus_return_policy', value: 'Proportional' }],
  };
  const invoice = { id: 'i1', invoiceNumber: 'INV-000001', status: 'Confirmed', customer: { id: 'c1', name: 'صيدلية الأمل' }, invoiceDate: '2026-10-09T08:00:00Z', netTotal: 90000,
    items: [{ id: 'ii1', product: { id: 'p1', nameAr: 'بنادول ٥٠٠' }, quantity: 10, bonusQuantity: 2, lineTotal: 90000, returnedQuantity: 0, bonusReturnedQuantity: 0, bonusRuleSnapshot: [{ min: 10, bonus: 2 }] }] };

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x'); const p = url.pathname; const q = Object.fromEntries(url.searchParams);
    let raw = ''; req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body; try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
      const send = (st, o) => { res.writeHead(st, { 'content-type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(o)); };
      const ok = (data, st = 200) => send(st, { success: true, data, message: null, meta: null });
      const fail = (st, message, code) => send(st, { success: false, data: null, message, code });
      if (!p.startsWith('/api/v1/')) {
        const f = path.join(ROOT, p === '/' ? 'index.html' : p);
        if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); return res.end('nf'); }
        res.writeHead(200, { 'content-type': MIME[path.extname(f)] || 'application/octet-stream' }); return res.end(fs.readFileSync(f));
      }
      const api = p.slice(7);
      state.requests.push({ method: req.method, path: api, query: q, body, headers: req.headers });
      if (api === '/sync/time') return ok({ serverTime: now() });
      if (api === '/auth/login') { if (body.identifier === 'rep' && body.password === 'Rep#12345') return ok({ accessToken: 'at1', refreshToken: 'rt1', mustChangePassword: false, user: {} }); return fail(401, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS'); }
      if (api === '/auth/refresh') return body.refreshToken === 'rt1' ? ok({ accessToken: 'at1', refreshToken: 'rt1' }) : fail(401, 'جلسة غير صالحة', 'INVALID_REFRESH_TOKEN');
      if ((req.headers.authorization || '') !== 'Bearer at1') return fail(401, 'يجب تسجيل الدخول', 'UNAUTHORIZED');
      if (api === '/auth/me') return ok({ id: 'u2', username: 'rep', fullName: 'مندوب اختبار', role: 'representative', permissions: ['sync.use', 'customers.view', 'products.view', 'products.view_prices', 'orders.create', 'visits.create', 'payments.create', 'returns.create', 'invoices.view', 'visit_plans.view'] });
      if (api === '/auth/logout' || api === '/auth/change-password') return ok(null);
      if (api.startsWith('/sync/pull/')) {
        const name = api.split('/')[3]; const items = entities[name];
        if (!items) return fail(404, 'الكيان غير معروف', 'UNKNOWN_ENTITY');
        return ok({ entity: name, serverTime: now(), items, nextCursor: null });
      }
      if (api === '/sync/push') {
        state.pushCalls++;
        if (!req.headers['x-device-id']) return fail(400, 'أرسل x-device-id', 'DEVICE_REQUIRED');
        const results = body.ops.map((o) => {
          const k = req.headers['x-device-id'] + ':' + o.localId;
          if (state.applied.has(k)) return { ...state.applied.get(k), duplicate: true };
          let r;
          if (o.type === 'payment' && o.payload.amount === 777) r = { localId: o.localId, status: 'Conflict', error: { code: 'INVOICE_NOT_OPEN', message: 'الفاتورة غير مفتوحة' } };
          else r = { localId: o.localId, status: 'Applied', serverId: 'srv-' + state.applied.size };
          state.applied.set(k, r); return r;
        });
        return ok({ serverTime: now(), results });
      }
      if (api === '/invoices' && req.method === 'GET') return ok([invoice]);
      if (api === '/invoices/i1') return ok(invoice);
      if (/^\/visit-plans\/.+\/status$/.test(api)) { entities.visitPlans.find((x) => api.includes(x.id)).status = body.status; return ok({}); }
      return fail(404, 'غير موجود', 'NOT_FOUND');
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, state, url: `http://127.0.0.1:${server.address().port}` })));
}
module.exports = { startMock };
if (require.main === module) startMock(Number(process.env.PORT || 4020)).then((m) => console.log('rep mock on ' + m.url));

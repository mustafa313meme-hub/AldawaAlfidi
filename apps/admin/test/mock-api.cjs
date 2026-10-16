// A small in-memory imitation of the API (same envelope, same shapes) used ONLY to test the admin UI in a real browser.
// It proves the UI code works; it does not prove the real API works. Serves the static admin app at "/" too.
const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const MIME = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };

function startMock(port = 0) {
  const state = {
    requests: [], refreshCount: 0, expireNext: false, nextToken: 10,
    tokens: { at1: 'admin', at2: 'rep', at3: 'newbie' }, refresh: { rt1: 'admin', rt2: 'rep', rt3: 'newbie' },
    customers: [
      { id: 'c1', code: 'C-000001', name: 'صيدلية الأمل', customerType: 'Pharmacy', phone: '07701234567', status: 'Active', assignedRepresentative: { id: 'r1', fullName: 'مندوب 1', employeeCode: 'R-0001' } },
      { id: 'c2', code: 'C-000002', name: '<img src=x onerror="window.__xss=1">', customerType: 'Doctor', phone: '07800000000', status: 'Active', assignedRepresentative: null },
    ],
    orders: { o1: { id: 'o1', orderNumber: 'ORD-000001', orderDate: '2026-10-09T08:00:00Z', customerId: 'c1', customer: { id: 'c1', code: 'C-000001', name: 'صيدلية الأمل' }, subtotal: 100000, discountTotal: 10000, bonusValue: 20000, total: 90000, status: 'Submitted',
      items: [{ id: 'oi1', product: { id: 'p1', sku: 'P-000001', nameAr: 'دواء اختبار' }, quantity: 10, bonusQuantity: 2, unitPrice: 10000, discountAmount: 10000, lineTotal: 90000 }] } },
    notifications: [{ id: 'n1', title: 'تنبيه صلاحية الأدوية', body: 'منتهية: 5 وحدة', createdAt: '2026-10-09T05:00:00Z', readAt: null }],
    conflicts: [{ id: 's1', opType: 'payment', status: 'Conflict', errorCode: 'INVOICE_NOT_OPEN', errorMessage: 'الفاتورة غير مفتوحة', attempts: 1, createdAt: '2026-10-09T06:00:00Z' }],
    visits: [
      { id: 'v1', representativeId: 'r1', representative: { id: 'r1', fullName: 'مندوب 1' }, customerId: 'c1', customer: { id: 'c1', code: 'C-000001', name: 'صيدلية الأمل' }, visitDate: '2026-10-14T00:00:00Z', startTime: '2026-10-14T07:10:00Z', endTime: null, visitType: 'Sales', outcome: 'طلب مبدئي', notes: null, nextVisitDate: null, latitude: 33.3152, longitude: 44.3661, accuracyM: 20, locationAt: '2026-10-14T07:10:00Z', distanceM: 40, locationStatus: 'Verified' },
      { id: 'v2', representativeId: 'r1', representative: { id: 'r1', fullName: 'مندوب 1' }, customerId: 'c2', customer: { id: 'c2', code: 'C-000002', name: 'د. سامر' }, visitDate: '2026-10-14T00:00:00Z', startTime: '2026-10-14T09:00:00Z', endTime: null, visitType: 'Medical', outcome: null, notes: null, nextVisitDate: null, latitude: null, longitude: null, accuracyM: null, locationAt: null, distanceM: null, locationStatus: 'NotProvided' },
    ],
    plan: [{ id: 'pl1', plannedOrder: 1, priority: 1, status: 'Done', visitId: 'v1', customer: { id: 'c1', code: 'C-000001', name: 'صيدلية الأمل', address: 'الكرادة' }, lastVisitDate: '2026-10-14' }],
    targets: [{ id: 't1', representativeId: 'r1', representative: { id: 'r1', fullName: 'مندوب 1' }, periodType: 'Monthly', startDate: '2026-10-01', endDate: '2026-10-31', targetAmount: 5000000, targetVisits: 100, targetOrders: 40, notes: null }],
    stockRows: [
      { id: 's1', quantity: 100, product: { id: 'p1', sku: 'P-000001', nameAr: 'دواء اختبار' }, warehouse: { id: 'w1', name: 'المخزن الرئيسي' } },
      { id: 's2', quantity: 30, product: { id: 'p2', sku: 'P-000002', nameAr: 'مرهم اختبار' }, warehouse: { id: 'w1', name: 'المخزن الرئيسي' } },
    ],
    settings: { bonus_return_policy: 'Proportional', require_location_for_visit: false, visit_block_when_far: false, visit_max_accuracy_m: 100, visit_max_distance_m: 300, overdue_days: 30, currency: 'IQD' },
  };
  const ALL = ['reports.sales', 'reports.inventory', 'reports.financial', 'reports.representatives', 'customers.view', 'customers.create', 'customers.update', 'customers.assign', 'customers.manage_credit', 'ledger.view',
    'orders.view', 'orders.create', 'orders.approve', 'invoices.view', 'invoices.create', 'invoices.cancel', 'returns.view', 'returns.create', 'returns.approve', 'payments.view', 'payments.create', 'payments.cancel',
    'products.view', 'products.create', 'products.update', 'products.view_prices', 'products.view_cost', 'inventory.view', 'purchases.view', 'purchases.create', 'purchases.receive', 'purchases.cancel', 'sync.manage',
    'companies.view', 'companies.create', 'companies.update', 'categories.view', 'warehouses.view', 'areas.view', 'areas.assign', 'representatives.view', 'price_lists.view', 'bonus_rules.view', 'bonus_rules.manage', 'inventory.transfer', 'inventory.adjust', 'visits.view', 'visits.view_all', 'visits.update', 'visit_plans.view', 'visit_plans.manage', 'targets.view', 'targets.manage', 'users.view', 'users.create', 'users.update', 'users.reset_password', 'devices.view', 'devices.revoke', 'audit.view', 'settings.view', 'settings.update'];
  const people = {
    admin: { id: 'u1', username: 'admin', fullName: 'مدير النظام', role: 'super_admin', permissions: ALL },
    rep: { id: 'u2', username: 'rep', fullName: 'مندوب اختبار', role: 'representative', permissions: ['customers.view', 'orders.view', 'products.view'] },
    newbie: { id: 'u3', username: 'newbie', fullName: 'مستخدم جديد', role: 'admin', permissions: ALL },
  };
  const invoice = () => ({ id: 'i1', invoiceNumber: 'INV-000001', status: 'Confirmed', customerId: 'c1', customer: { id: 'c1', code: 'C-000001', name: 'صيدلية الأمل' }, warehouse: { id: 'w1', name: 'المخزن الرئيسي' },
    invoiceDate: '2026-10-09T08:00:00Z', subtotal: 100000, discountTotal: 10000, taxTotal: 0, netTotal: 90000, paidAmount: 50000, returnedAmount: 0, remainingAmount: 40000, paymentStatus: 'Partial', bonusValue: 20000,
    items: [{ id: 'ii1', product: { id: 'p1', sku: 'P-000001', nameAr: 'دواء اختبار' }, quantity: 10, bonusQuantity: 2, unitPrice: 10000, discountAmount: 10000, lineTotal: 90000, returnedQuantity: 0, bonusReturnedQuantity: 0, bonusRuleSnapshot: [{ min: 10, bonus: 2 }] }] });
  const page = (data, q) => ({ data, meta: { page: Number(q.page || 1), pageSize: Number(q.pageSize || 20), total: data.length } });

  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://x');
    const p = url.pathname;
    const q = Object.fromEntries(url.searchParams);
    let raw = '';
    req.on('data', (c) => (raw += c));
    req.on('end', () => {
      let body;
      try { body = raw ? JSON.parse(raw) : undefined; } catch { body = undefined; }
      const send = (status, obj, type = 'application/json; charset=utf-8') => { res.writeHead(status, { 'content-type': type }); res.end(typeof obj === 'string' ? obj : JSON.stringify(obj)); };
      const ok = (data, meta = null, status = 200) => send(status, { success: true, data, message: null, meta });
      const fail = (status, message, code, details) => send(status, { success: false, data: null, message, code, ...(details ? { details } : {}) });

      if (!p.startsWith('/api/v1/')) { // static files
        const file = path.join(ROOT, p === '/' ? 'index.html' : p);
        if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) { res.writeHead(404); return res.end('not found'); }
        res.writeHead(200, { 'content-type': MIME[path.extname(file)] || 'application/octet-stream' });
        return res.end(fs.readFileSync(file));
      }
      const api = p.slice('/api/v1'.length);
      state.requests.push({ method: req.method, path: api, query: q, body, headers: req.headers });
      if (Number(q.pageSize) > 100 && !api.startsWith('/reports/')) return fail(400, 'بيانات غير صالحة', 'VALIDATION_ERROR', ['pageSize must not be greater than 100']); // same limit as the real API

      // ───── test controls
      if (api === '/__test/expire') { state.expireNext = true; return ok(true); }
      if (api === '/__test/reset-requests') { state.requests.length = 0; return ok(true); }

      // ───── auth
      if (api === '/auth/login' && req.method === 'POST') {
        const m = { admin: ['Admin#12345', 'at1', 'rt1', false], rep: ['Rep#12345', 'at2', 'rt2', false], newbie: ['Temp#12345', 'at3', 'rt3', true] }[body && body.identifier];
        if (!m || m[0] !== body.password) return fail(401, 'بيانات الدخول غير صحيحة', 'INVALID_CREDENTIALS');
        return ok({ accessToken: m[1], refreshToken: m[2], mustChangePassword: m[3], user: {} });
      }
      if (api === '/auth/refresh' && req.method === 'POST') {
        const who = state.refresh[body && body.refreshToken];
        if (!who) return fail(401, 'جلسة غير صالحة', 'INVALID_REFRESH_TOKEN');
        state.refreshCount++;
        const t = 'at-r' + state.nextToken++;
        state.tokens[t] = who;
        return ok({ accessToken: t, refreshToken: body.refreshToken, tokenType: 'Bearer' });
      }
      const bearer = (req.headers.authorization || '').replace('Bearer ', '');
      const who = state.tokens[bearer];
      if (!who) return fail(401, 'يجب تسجيل الدخول', 'UNAUTHORIZED');
      if (state.expireNext) { state.expireNext = false; delete state.tokens[bearer]; return fail(401, 'يجب تسجيل الدخول', 'UNAUTHORIZED'); }
      const me = people[who];
      const needs = (perm) => me.role === 'super_admin' || me.permissions.includes(perm);

      if (api === '/auth/me') return ok(me);
      if (api === '/auth/logout' || api === '/auth/change-password') return ok(null);
      if (api.startsWith('/reports/') && !needs('reports.sales')) return fail(403, 'غير مسموح لك بتنفيذ هذه العملية', 'FORBIDDEN');

      // ───── data
      if (api === '/dashboard') return ok({ sales: { today: { invoices: 3, amount: 270000, discount: 0 }, month: { invoices: 40, amount: 5400000, discount: 0 } }, returns: { today: { count: 1, amount: 18000 }, month: { count: 4, amount: 90000 } },
        netSales: { today: 252000, month: 5310000 }, collections: { today: { count: 2, amount: 80000 }, month: { count: 20, amount: 3000000 } }, orders: { today: 5, pendingApproval: 2 }, receivables: { total: 1500000, debtors: 12 },
        representatives: { active: 8, visitsToday: 30 }, inventory: { lowStockProducts: 3, nearExpiry30d: { batches: 2, units: 40 }, expired: { batches: 1, units: 5 } },
        topCustomers: [{ code: 'C-000001', name: 'صيدلية الأمل', net: 90000 }], topProducts: [{ code: 'P-000001', name: 'دواء اختبار', quantity: 10, net: 90000 }], topRepresentatives: [{ code: 'R-0001', name: 'مندوب 1', invoices: 3, net: 270000 }] });
      if (api === '/notifications/unread-count') return ok({ unread: state.notifications.filter((n) => !n.readAt).length });
      if (api === '/notifications' && req.method === 'GET') return ok(state.notifications, { page: 1, pageSize: 50, total: state.notifications.length });
      if (api.startsWith('/notifications/') && api.endsWith('/read')) { state.notifications.forEach((n) => { n.readAt = 'x'; }); return ok(null); }
      if (api === '/notifications/read-all') { state.notifications.forEach((n) => { n.readAt = 'x'; }); return ok({ marked: 1 }); }

      if (api === '/customers' && req.method === 'GET') { const rows = state.customers.filter((c) => !q.q || c.name.includes(q.q) || c.code.includes(q.q)); const r = page(rows, q); return ok(r.data, r.meta); }
      if (api === '/customers' && req.method === 'POST') {
        if (!body || !body.name) return fail(400, 'بيانات غير صالحة', 'VALIDATION_ERROR', ['name should not be empty']);
        const c = { id: 'c' + (state.customers.length + 1), code: 'C-00000' + (state.customers.length + 1), customerType: 'Pharmacy', status: 'Active', phone: body.phone, assignedRepresentative: null, ...body };
        state.customers.push(c); return ok(c, null, 201);
      }
      if (/^\/customers\/c\d+$/.test(api) && req.method === 'GET') { const c = state.customers.find((x) => '/customers/' + x.id === api); return c ? ok({ ...c, area: { id: 'a1', name: 'الكرادة' }, priceList: null, creditLimit: 0, lastVisitDate: '2026-10-08' }) : fail(404, 'العميل غير موجود', 'NOT_FOUND'); }
      if (/\/customers\/c\d+\/balance$/.test(api)) return ok({ customerId: 'c1', balance: 22000, creditLimit: 0, availableCredit: null, unallocatedPayments: 0 });
      if (/\/customers\/c\d+\/open-invoices$/.test(api)) return ok([{ id: 'i1', invoiceNumber: 'INV-000001', invoiceDate: '2026-10-09T08:00:00Z', netTotal: 90000, paidAmount: 50000, returnedAmount: 18000, remainingAmount: 22000, paymentStatus: 'Partial', ageDays: 3 }]);
      if (/\/customers\/c\d+\/statement$/.test(api)) return ok({ customer: { id: 'c1', code: 'C-000001', name: 'صيدلية الأمل' }, openingBalance: 0, closingBalance: 22000, truncated: false,
        entries: [{ id: 'e1', entryDate: '2026-10-09T08:00:00Z', entryType: 'Invoice', debit: 90000, credit: 0, description: 'INV-000001', balance: 90000 }, { id: 'e2', entryDate: '2026-10-09T09:00:00Z', entryType: 'Payment', debit: 0, credit: 50000, description: 'PAY-000001', balance: 40000 }, { id: 'e3', entryDate: '2026-10-09T10:00:00Z', entryType: 'Return', debit: 0, credit: 18000, description: 'RET-000001', balance: 22000 }] });
      if (api === '/customers/map') {
        if ((q.lat === undefined) !== (q.lng === undefined)) return fail(400, 'أرسل lat و lng معاً', 'INVALID_LOCATION');
        const pts = [{ id: 'c1', code: 'C-000001', name: 'صيدلية الأمل', customerType: 'Pharmacy', status: 'Active', latitude: 33.3152, longitude: 44.3661, address: 'الكرادة' },
          { id: 'c2', code: 'C-000002', name: '<img src=x onerror="window.__xss=1">', customerType: 'Doctor', status: 'Suspended', latitude: 33.33, longitude: 44.40, address: null },
          { id: 'c3', code: 'C-000003', name: 'مستشفى الشفاء', customerType: 'Hospital', status: 'Blocked', latitude: 33.29, longitude: 44.35, address: 'الجادرية' }];
        return ok(q.status ? pts.filter((x) => x.status === q.status) : pts.map((x) => ({ ...x, distanceM: q.lat ? 1200 : null })));
      }
      if (api === '/visits' && req.method === 'GET') { const rows = state.visits.filter((v) => (!q.locationStatus || v.locationStatus === q.locationStatus) && (!q.representativeId || v.representativeId === q.representativeId)); const r = page(rows, q); return ok(r.data, r.meta); }
      if (/^\/visits\/v\d+$/.test(api) && req.method === 'GET') { const v = state.visits.find((x) => '/visits/' + x.id === api); return v ? ok(v) : fail(404, 'الزيارة غير موجودة', 'NOT_FOUND'); }
      if (/^\/visits\/v\d+$/.test(api) && req.method === 'PATCH') { const v = state.visits.find((x) => '/visits/' + x.id === api); Object.assign(v, body); return ok(v); }
      if (api === '/visit-plans' && req.method === 'GET') {
        if (!q.date) return fail(400, 'بيانات غير صالحة', 'VALIDATION_ERROR', ['date must be a valid ISO 8601 date string']);
        if (!q.representativeId) return fail(400, 'حدّد المندوب', 'REP_REQUIRED');
        return ok(state.plan);
      }
      if (api === '/visit-plans/day' && req.method === 'PUT') {
        const ids = body.items.map((i) => i.customerId);
        if (new Set(ids).size !== ids.length) return fail(400, 'عميل مكرر في الخطة', 'DUPLICATE_ITEMS');
        const done = state.plan.filter((p) => p.status === 'Done');
        const names = { c1: ['C-000001', 'صيدلية الأمل'], c2: ['C-000002', 'د. سامر'] };
        state.plan = [...done, ...body.items.filter((i) => !done.some((d) => d.customer.id === i.customerId)).map((i, n) => ({ id: 'pl' + (n + 10), plannedOrder: done.length + n + 1, priority: i.priority ?? 0, status: 'Planned', visitId: null, customer: { id: i.customerId, code: (names[i.customerId] || ['C-?'])[0], name: (names[i.customerId] || [0, 'عميل'])[1], address: null }, lastVisitDate: null }))];
        return ok({ planned: state.plan.length - done.length, keptDone: done.length });
      }
      if (api === '/sales-targets' && req.method === 'GET') { const r = page(state.targets, q); return ok(r.data, r.meta); }
      if (api === '/sales-targets' && req.method === 'POST') { if (body.endDate < body.startDate) return fail(400, 'تاريخ النهاية قبل البداية', 'INVALID_RANGE'); const t = { id: 't' + (state.targets.length + 1), representative: { id: body.representativeId, fullName: 'مندوب 1' }, ...body }; state.targets.push(t); return ok(t, null, 201); }
      if (/^\/sales-targets\/t\d+$/.test(api) && req.method === 'PATCH') { const t = state.targets.find((x) => '/sales-targets/' + x.id === api); Object.assign(t, body); return ok(t); }
      if (api === '/stock' && req.method === 'GET') return ok(state.stockRows, { page: 1, pageSize: 100, total: state.stockRows.length });
      if (api === '/inventory/batches' && req.method === 'GET') return ok([
        { id: 'b1', product: { id: 'p1', sku: 'P-000001', nameAr: 'دواء اختبار' }, warehouse: { id: 'w1', name: 'المخزن الرئيسي' }, batchNumber: 'B-1', expiryDate: '2027-05-01', quantity: 60, daysToExpiry: 200, expired: false },
        { id: 'b2', product: { id: 'p1', sku: 'P-000001', nameAr: 'دواء اختبار' }, warehouse: { id: 'w1', name: 'المخزن الرئيسي' }, batchNumber: 'B-2', expiryDate: '2027-09-01', quantity: 30, daysToExpiry: 320, expired: false },
      ], { page: 1, pageSize: 100, total: 2 });
      if (api === '/inventory/stocktake' && req.method === 'POST') {
        const report = body.counts.map((c) => { const sys = c.batchId === 'b1' ? 60 : c.batchId === 'b2' ? 30 : c.productId === 'p1' ? 10 : 30; return { productId: c.productId, batchId: c.batchId || null, system: sys, counted: c.countedQuantity, difference: c.countedQuantity - sys }; });
        const adj = report.filter((r) => r.difference !== 0).length;
        return ok(adj ? { adjusted: adj, adjustmentId: 'adj1', adjustmentNumber: 'ADJ-000001', report } : { adjusted: 0, adjustmentId: null, report });
      }
      if (api === '/companies' && req.method === 'POST') return ok({ id: 'co9', ...body }, null, 201);
      if (api === '/bonus-rules' && req.method === 'POST') return ok({ id: 'b1', ...body }, null, 201);
      if (api === '/transfers' && req.method === 'POST') return ok({ id: 't1', transferNumber: 'TRF-000001' }, null, 201);
      if (api === '/areas/x1/assign') return ok({ id: 'ra1' }, null, 201);
      if (api === '/areas' && req.method === 'GET') return ok([{ id: 'x1', name: 'الكرادة', city: 'بغداد', district: null, isActive: true, responsible: null }], null);
      if (['/areas', '/companies', '/categories', '/price-lists', '/warehouses'].includes(api)) return ok([{ id: 'x1', name: api.slice(1), city: 'بغداد' }], { page: 1, pageSize: 200, total: 1 });
      if (api === '/representatives') return ok([{ id: 'r1', employeeCode: 'R-0001', fullName: 'مندوب 1' }], { page: 1, pageSize: 200, total: 1 });
      if (api === '/roles') return ok([{ id: 'ro1', name: 'representative' }, { id: 'ro2', name: 'admin' }]);
      if (api === '/products') return ok([{ id: 'p1', sku: 'P-000001', nameAr: 'دواء اختبار', company: { id: 'co1', name: 'شركة' }, category: null, salePrice: 12000, barcode: null, isActive: true }], { page: 1, pageSize: 20, total: 1 });
      if (api === '/orders' && req.method === 'GET') { const r = page(Object.values(state.orders), q); return ok(r.data, r.meta); }
      if (/^\/orders\/o1$/.test(api)) return ok(state.orders.o1);
      if (api === '/orders/o1/approve') { state.orders.o1.status = 'Approved'; return ok({ id: 'o1', status: 'Approved' }); }
      if (api === '/invoices' && req.method === 'GET') { const r = page([invoice()], q); return ok(r.data, r.meta); }
      if (api === '/invoices' && req.method === 'POST') return ok({ ...invoice(), id: 'i2', invoiceNumber: 'INV-000002' }, null, 201);
      if (api === '/invoices/i1' || api === '/invoices/i2') return ok(invoice());
      if (api === '/purchases/x1' && req.method === 'GET') return ok({ id: 'x1', orderNumber: 'PO-000001', status: 'Ordered', company: { name: 'شركة' }, warehouse: { name: 'المخزن الرئيسي' }, orderDate: '2026-10-09T08:00:00Z', total: 600000, discountTotal: 0, notes: null,
        items: [{ id: 'pi1', product: { id: 'p1', nameAr: 'دواء اختبار' }, quantity: 100, bonusQuantity: 0, unitCost: 6000, discountAmount: 0, lineTotal: 600000 }] });
      if (api === '/purchases/x1/receive') return ok({ id: 'x1', status: 'Received' });
      if (api === '/purchases' && req.method === 'POST') return ok({ id: 'x1', orderNumber: 'PO-000001' }, null, 201);
      if (api === '/payments' && req.method === 'POST') return ok({ id: 'pay1', paymentNumber: 'PAY-000001', amount: body.amount, allocatedAmount: Math.min(body.amount, 22000), allocations: [{ amount: Math.min(body.amount, 22000), invoice: { invoiceNumber: 'INV-000001' } }] }, null, 201);
      if (api === '/users' && req.method === 'POST') return ok({ id: 'u9', username: body.username }, null, 201);
      if (api === '/returns' && req.method === 'GET') return ok([], { page: 1, pageSize: 20, total: 0 });
      if (api === '/returns' && req.method === 'POST') return ok({ id: 'ret1', returnNumber: 'RET-000001', creditAmount: 18000, billedAmount: 0, items: [{ lineType: 'Sold', quantity: 2, amount: 18000, required: false }, { lineType: 'Bonus', quantity: 2, amount: 0, required: true }] }, null, 201);
      if (api === '/settings' && req.method === 'GET') return ok(state.settings);
      if (api.startsWith('/settings/') && req.method === 'PUT') { state.settings[api.split('/')[2]] = body.value; return ok({ key: api.split('/')[2], value: body.value }); }
      if (api === '/reports/sales/daily') {
        if (q.format === 'csv') return send(200, '\uFEFFاليوم,صافي الفواتير\r\n2026-10-09,90000\r\n', 'text/csv; charset=utf-8');
        return ok({ title: 'المبيعات اليومية', columns: [{ key: 'period', header: 'اليوم' }, { key: 'invoices', header: 'عدد الفواتير' }, { key: 'net', header: 'صافي الفواتير' }], rows: [{ period: '2026-10-09', invoices: 3, net: 270000 }], totals: { invoices: 3, net: 270000 }, meta: { note: 'المردودات تُنسب لتاريخ المردود' } });
      }
      if (api === '/sync/conflicts' && req.method === 'GET') return ok(state.conflicts, { page: 1, pageSize: 20, total: state.conflicts.length });
      if (api === '/sync/conflicts/s1') return ok({ ...state.conflicts[0], deviceId: 'dev-1', user: { id: 'u2', username: 'rep', fullName: 'مندوب اختبار' }, payload: { customerId: 'c1', amount: 5000, method: 'Cash' }, errorDetails: { invoiceId: 'i1' } });
      if (api === '/sync/conflicts/s1/resolve') { if (body.action === 'discard' && !body.note) return fail(400, 'سبب التجاهل مطلوب', 'NOTE_REQUIRED'); return ok({ id: 's1', status: 'Discarded' }); }
      if (api === '/users' && req.method === 'GET') return ok([{ id: 'u2', username: 'rep', fullName: 'مندوب اختبار', role: { id: 'ro1', name: 'representative' }, phone: null, isActive: true, lastLoginAt: null }], { page: 1, pageSize: 20, total: 1 });
      if (req.method === 'GET') return ok([], { page: 1, pageSize: 20, total: 0 }); // everything else: an empty list
      return ok({ id: 'new' }, null, 201);
    });
  });
  return new Promise((resolve) => server.listen(port, '127.0.0.1', () => resolve({ server, state, port: server.address().port, url: `http://127.0.0.1:${server.address().port}` })));
}

module.exports = { startMock };
if (require.main === module) startMock(Number(process.env.PORT || 4010)).then((m) => console.log('mock API + admin UI on ' + m.url));

// Browser tests for the admin UI (real Chromium) against the mock API. Run:
//   npm i -D playwright && npx playwright install chromium     (once)
//   node apps/admin/test/ui.test.cjs
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { chromium } = require('playwright');
const { startMock } = require('./mock-api.cjs');

const results = [];
let currentPage = null;
async function step(name, fn) {
  try { await fn(); results.push({ name, ok: true }); console.log('  PASS  ' + name); } catch (e) {
    results.push({ name, ok: false, err: e });
    console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').slice(0, 4).join('\n        '));
    await currentPage.evaluate(() => document.querySelectorAll('.overlay').forEach((o) => o.remove())).catch(() => {}); // a failed step must not leave a dialog that blocks the next ones
  }
}

(async () => {
  const mock = await startMock(0);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ar', acceptDownloads: true });
  const page = await ctx.newPage();
  page.setDefaultTimeout(6000);
  currentPage = page;
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && /Content Security Policy|Uncaught|TypeError|ReferenceError/.test(t)) problems.push('console: ' + t); });

  const base = mock.url;
  const lastReq = (method, path) => [...mock.state.requests].reverse().find((r) => r.method === method && r.path === path);
  const login = async (user, pass) => {
    await page.goto(base + '/');
    await page.fill('input[aria-label="اسم المستخدم"]', user);
    await page.fill('input[aria-label="كلمة المرور"]', pass);
    await page.click('button:has-text("دخول")');
  };
  const goto = async (hash) => { await page.evaluate((h) => { location.hash = h; }, hash); await page.waitForTimeout(150); };
  const menu = async () => (await page.locator('.side a').allTextContents()).map((s) => s.trim());

  console.log('\nAdmin UI tests (Chromium + mock API)\n');

  await step('login: wrong password shows the server message and stays on the login screen', async () => {
    await login('admin', 'wrong');
    await page.waitForSelector('.login .err:has-text("بيانات الدخول غير صحيحة")');
    assert.equal(await page.locator('.shell').count(), 0);
  });

  await step('login: admin enters, dashboard KPIs render, sidebar is complete', async () => {
    await login('admin', 'Admin#12345');
    await page.waitForSelector('.kpi');
    assert.ok((await page.locator('.kpi .l').allTextContents()).includes('مبيعات اليوم'));
    assert.ok(!(await page.locator('.side').innerText()).includes('http'), 'sidebar must contain labels, not URLs');
    assert.ok((await page.locator('.kpi .v').first().textContent()).includes('270,000'));
    const m = await menu();
    for (const t of ['لوحة المتابعة', 'العملاء', 'الفواتير', 'المردودات', 'التقارير', 'الإعدادات', 'المستخدمون', 'الشركات', 'المناطق', 'المندوبون', 'قواعد البونص', 'التحويل بين المخازن']) assert.ok(m.includes(t), 'menu is missing ' + t);
    assert.equal(await page.locator('.bell .n').textContent(), '1');
  });

  await step('customers: list renders and hostile names stay inert text (no XSS)', async () => {
    await goto('#/customers');
    await page.waitForSelector('tbody tr');
    assert.equal(await page.locator('tbody tr').count(), 2);
    assert.ok((await page.locator('tbody').textContent()).includes('<img src=x onerror='));
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    assert.equal(await page.locator('tbody img').count(), 0);
  });

  await step('customers: search sends q and filters the table', async () => {
    await page.fill('input[type=search]', 'الأمل');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 1);
    assert.equal(lastReq('GET', '/customers').query.q, 'الأمل');
  });

  await step('customers: create — required field message, then POST and the new row appears', async () => {
    await goto('#/customers');
    await page.waitForSelector('tbody tr');
    await page.fill('input[type=search]', ''); // the page keeps its search text from the previous step
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length >= 2);
    await page.click('button:has-text("عميل جديد")');
    await page.click('.modal .actions button:has-text("حفظ")');
    assert.ok((await page.locator('.modal .err').first().textContent()).includes('مطلوب'));
    await page.fill('.modal input[name=name]', 'صيدلية الشفاء');
    await page.fill('.modal input[name=phone]', '07712345678');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('#toasts .toast:has-text("تم")');
    const req = lastReq('POST', '/customers');
    assert.equal(req.body.name, 'صيدلية الشفاء');
    assert.equal(req.body.phone, '07712345678');
    assert.equal(req.body.creditLimit, undefined, 'empty number fields must not be sent');
    await page.waitForFunction(() => document.body.textContent.includes('صيدلية الشفاء'));
  });

  await step('customer detail: balance, open invoices and statement', async () => {
    await goto('#/customers/c1');
    await page.waitForSelector('h3:has-text("كشف الحساب")');
    const t = await page.locator('#view').textContent();
    assert.ok(t.includes('22,000'), 'balance');
    assert.ok(t.includes('INV-000001') && t.includes('PAY-000001') && t.includes('RET-000001'));
    assert.ok(!/\[object |undefined|NaN/.test(t), 'rendering artefact in the customer page');
  });

  await step('invoice detail: items and totals', async () => {
    await goto('#/invoices/i1');
    await page.waitForSelector('h2:has-text("INV-000001")');
    const t = await page.locator('#view').textContent();
    assert.ok(t.includes('دواء اختبار') && t.includes('90,000') && t.includes('40,000'));
    assert.ok(await page.locator('a:has-text("إنشاء مردود")').count() === 1);
  });

  await step('return: preview shows the bonus the policy will demand, max = returnable, submit sends the right body', async () => {
    await goto('#/returns/new?invoice=i1');
    await page.waitForSelector('input[aria-label="كمية مباعة مرتجعة"]');
    assert.equal(await page.getAttribute('input[aria-label="كمية مباعة مرتجعة"]', 'max'), '10');
    assert.equal(await page.getAttribute('input[aria-label="بونص مرتجع"]', 'max'), '2');
    await page.fill('input[aria-label="كمية مباعة مرتجعة"]', '2');
    const note = await page.locator('#view .note').last().textContent();
    assert.ok(note.includes('18,000'), 'credit estimate: ' + note);
    assert.ok(note.includes('البونص المطلوب إرجاعه حسب السياسة: 2'), 'required bonus: ' + note);
    await page.click('button:has-text("تسجيل المردود")');
    await page.waitForSelector('.modal h3:has-text("RET-000001")');
    const body = lastReq('POST', '/returns').body;
    assert.deepEqual(body.items, [{ invoiceItemId: 'ii1', soldQuantity: 2, bonusQuantity: 0, condition: 'Valid' }]);
    assert.equal(body.invoiceId, 'i1');
    await page.click('.modal .actions button:has-text("عرض الفاتورة")');
  });

  await step('return: nothing entered is refused before calling the server', async () => {
    await goto('#/returns/new?invoice=i1');
    await page.waitForSelector('input[aria-label="كمية مباعة مرتجعة"]');
    const before = mock.state.requests.filter((r) => r.method === 'POST' && r.path === '/returns').length;
    await page.click('button:has-text("تسجيل المردود")');
    await page.waitForSelector('.errbox:has-text("أدخل كمية")');
    assert.equal(mock.state.requests.filter((r) => r.method === 'POST' && r.path === '/returns').length, before);
  });

  await step('new invoice: pick customer + product, quantity, warehouse; POST carries an Idempotency-Key', async () => {
    await goto('#/invoices/new');
    await page.fill('input[placeholder="ابحث عن العميل (اسم/هاتف/كود)"]', 'الأمل');
    await page.click('.pick-list button:has-text("C-000001")');
    await page.fill('input[placeholder="ابحث عن منتج (اسم/رمز/باركود) لإضافته"]', 'دواء');
    await page.click('.pick-list button:has-text("P-000001")');
    await page.fill('input[aria-label="الكمية"]', '3');
    await page.selectOption('select[name=warehouseId]', 'x1');
    await page.click('button:has-text("إنشاء الفاتورة")');
    await page.waitForSelector('h2:has-text("INV-000001")'); // mock returns the same detail for i2
    const req = lastReq('POST', '/invoices');
    assert.equal(req.body.customerId, 'c1');
    assert.equal(req.body.warehouseId, 'x1');
    assert.deepEqual(req.body.lines, [{ productId: 'p1', quantity: 3 }]);
    assert.ok(/^[0-9a-f-]{36}$/.test(req.headers['idempotency-key']), 'idempotency key header');
  });

  await step('new invoice: no customer / no lines are refused client-side', async () => {
    await goto('#/invoices/new');
    await page.waitForSelector('button:has-text("إنشاء الفاتورة")');
    const before = mock.state.requests.filter((r) => r.method === 'POST' && r.path === '/invoices').length;
    await page.click('button:has-text("إنشاء الفاتورة")');
    await page.waitForSelector('.errbox:has-text("اختر العميل")');
    assert.equal(mock.state.requests.filter((r) => r.method === 'POST' && r.path === '/invoices').length, before);
  });

  await step('purchase: create — company first, then lines with cost; POST body is right', async () => {
    await goto('#/purchases/new');
    await page.waitForSelector('select[name=companyId]');
    await page.selectOption('select[name=companyId]', 'x1');
    await page.selectOption('select[name=warehouseId]', 'x1');
    await page.fill('input[placeholder="ابحث عن منتج (اسم/رمز/باركود) لإضافته"]', 'دواء');
    await page.click('.pick-list button:has-text("P-000001")');
    await page.fill('input[aria-label="الكمية"]', '100');
    await page.fill('input[aria-label="التكلفة"]', '6000');
    await page.click('button:has-text("حفظ كمسودة")');
    await page.waitForSelector('h2:has-text("PO-000001")');
    const b = lastReq('POST', '/purchases').body;
    assert.equal(b.companyId, 'x1');
    assert.deepEqual(b.items, [{ productId: 'p1', quantity: 100, bonusQuantity: 0, unitCost: 6000, discountAmount: 0 }]);
    assert.equal(lastReq('GET', '/products').query.companyId, 'x1', 'the product search is limited to the supplier company');
  });

  await step('purchase: receiving needs a batch number, then sends batches with expiry', async () => {
    await goto('#/purchases/x1');
    await page.waitForSelector('button:has-text("استلام")');
    await page.click('button:has-text("استلام")');
    await page.click('.modal .actions button:has-text("تأكيد الاستلام")');
    await page.waitForSelector('.modal .errbox:has-text("رقم التشغيلة مطلوب")');
    await page.fill('.modal input[aria-label="رقم التشغيلة"]', 'B1-2026');
    await page.fill('.modal input[aria-label="تاريخ الانتهاء"]', '2028-01-31');
    await page.click('.modal .actions button:has-text("تأكيد الاستلام")');
    await page.waitForSelector('#toasts .toast:has-text("تم الاستلام")');
    assert.deepEqual(lastReq('POST', '/purchases/x1/receive').body, { lines: [{ itemId: 'pi1', batchNumber: 'B1-2026', expiryDate: '2028-01-31', quantity: 100, bonusQuantity: 0 }] });
  });

  await step('payment: choose customer, the open invoices load, the allocation result is shown', async () => {
    await goto('#/payments');
    await page.waitForSelector('button:has-text("تسجيل تسديد")');
    await page.click('button:has-text("تسجيل تسديد")');
    await page.fill('.modal input[placeholder="ابحث عن العميل"]', 'الأمل');
    await page.click('.modal .pick-list button:has-text("C-000001")');
    await page.waitForSelector('.modal select[aria-label="الفاتورة"] option:has-text("INV-000001")', { state: 'attached' });
    await page.fill('.modal input[name=amount]', '30000');
    await page.selectOption('.modal select[name=method]', 'Cash');
    await page.click('.modal .actions button:has-text("تسجيل")');
    await page.waitForSelector('.modal h3:has-text("PAY-000001")');
    const b = lastReq('POST', '/payments').body;
    assert.equal(b.customerId, 'c1');
    assert.equal(b.amount, 30000);
    assert.equal(b.method, 'Cash');
    const t = await page.locator('.modal').last().innerText();
    assert.ok(t.includes('رصيد دائن على الحساب 8,000'), 'unallocated credit shown: ' + t);
    await page.click('.modal .actions button:has-text("إغلاق")');
  });

  await step('users: create sends the typed values and not empty optional fields', async () => {
    await goto('#/users');
    await page.waitForSelector('button:has-text("مستخدم جديد")');
    await page.click('button:has-text("مستخدم جديد")');
    await page.fill('.modal input[name=username]', 'new.rep');
    await page.fill('.modal input[name=fullName]', 'مندوب جديد');
    await page.fill('.modal input[name=password]', 'Temp-pass-123');
    await page.selectOption('.modal select[name=roleId]', 'ro1');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('#toasts .toast:has-text("تم")');
    assert.deepEqual(lastReq('POST', '/users').body, { username: 'new.rep', fullName: 'مندوب جديد', password: 'Temp-pass-123', roleId: 'ro1' });
  });

  await step('master data: create a company', async () => {
    await goto('#/companies');
    await page.waitForSelector('button:has-text("إضافة")');
    await page.click('button:has-text("إضافة")');
    await page.fill('.modal input[name=name]', 'شركة الأمل للأدوية');
    await page.fill('.modal input[name=paymentTerms]', '30 يوماً');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('#toasts .toast:has-text("تم")');
    assert.deepEqual(lastReq('POST', '/companies').body, { name: 'شركة الأمل للأدوية', paymentTerms: '30 يوماً' });
  });

  await step('master data: assign an area to a representative', async () => {
    await goto('#/areas');
    await page.waitForSelector('tbody tr');
    await page.click('tbody tr');
    await page.click('.modal .actions button:has-text("إسناد لمندوب")');
    await page.selectOption('.modal select[name=representativeId]', 'r1');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('#toasts .toast:has-text("تم")');
    assert.deepEqual(lastReq('POST', '/areas/x1/assign').body, { representativeId: 'r1' });
  });

  await step('master data: a bonus rule needs a product and sends the typed rule', async () => {
    await goto('#/bonus-rules');
    await page.waitForSelector('button:has-text("قاعدة جديدة")');
    await page.click('button:has-text("قاعدة جديدة")');
    await page.fill('.modal input[name=minQuantity]', '10');
    await page.fill('.modal input[name=bonusQuantity]', '2');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('.modal .errbox:has-text("اختر المنتج")');
    await page.fill('.modal input[placeholder="ابحث عن المنتج"]', 'دواء');
    await page.click('.modal .pick-list button:has-text("P-000001")');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('#toasts .toast:has-text("تم")');
    assert.deepEqual(lastReq('POST', '/bonus-rules').body, { minQuantity: 10, bonusQuantity: 2, productId: 'p1' });
  });

  await step('inventory: a transfer needs lines, then sends warehouses and quantities', async () => {
    await goto('#/transfers');
    await page.waitForSelector('button:has-text("تحويل جديد")');
    await page.click('button:has-text("تحويل جديد")');
    await page.selectOption('.modal select[name=fromWarehouseId]', 'x1');
    await page.selectOption('.modal select[name=toWarehouseId]', 'x1');
    await page.click('.modal .actions button:has-text("تنفيذ")');
    await page.waitForSelector('.modal .errbox:has-text("أضف منتجاً")');
    await page.fill('.modal input[placeholder="ابحث عن منتج (اسم/رمز/باركود) لإضافته"]', 'دواء');
    await page.click('.modal .pick-list button:has-text("P-000001")');
    await page.fill('.modal input[aria-label="الكمية"]', '5');
    await page.click('.modal .actions button:has-text("تنفيذ")');
    await page.waitForSelector('#toasts .toast:has-text("تم التنفيذ")');
    assert.deepEqual(lastReq('POST', '/transfers').body, { fromWarehouseId: 'x1', toWarehouseId: 'x1', items: [{ productId: 'p1', quantity: 5 }] });
  });

  await step('orders: detail, approve changes the status', async () => {
    await goto('#/orders/o1');
    await page.waitForSelector('button:has-text("اعتماد")');
    await page.click('button:has-text("اعتماد")');
    await page.waitForFunction(() => [...document.querySelectorAll('.badge')].some((b) => b.textContent === 'معتمد'));
  });

  await step('reports: run shows rows and totals; CSV downloads a BOM file named by report and date', async () => {
    await goto('#/reports?r=sd');
    await page.waitForSelector('button:has-text("عرض")');
    await page.click('button:has-text("عرض")');
    await page.waitForSelector('#view table td:has-text("270,000")'); // wait for the RESULT (the heading exists before it loads)
    const t = await page.locator('#view').textContent();
    assert.ok(t.includes('270,000') && t.includes('الإجماليات'));
    const q = lastReq('GET', '/reports/sales/daily').query;
    assert.ok(/^\d{4}-\d{2}-01$/.test(q.from) && /^\d{4}-\d{2}-\d{2}$/.test(q.to), 'default range is this month: ' + JSON.stringify(q));
    const [dl] = await Promise.all([page.waitForEvent('download'), page.click('button:has-text("تصدير CSV")')]);
    assert.ok(/^sd-\d{4}-\d{2}-\d{2}\.csv$/.test(dl.suggestedFilename()), dl.suggestedFilename());
    const bytes = fs.readFileSync(await dl.path());
    assert.deepEqual([...bytes.slice(0, 3)], [0xef, 0xbb, 0xbf], 'UTF-8 BOM for Excel');
    assert.equal(lastReq('GET', '/reports/sales/daily').query.format, 'csv');
  });

  await step('session: an expired access token is refreshed transparently, the user stays signed in', async () => {
    await fetch(base + '/api/v1/__test/expire');
    const before = mock.state.refreshCount;
    await page.click('.side a:has-text("الطلبات")');
    await page.waitForSelector('tbody tr:has-text("ORD-000001")');
    assert.equal(mock.state.refreshCount, before + 1);
    assert.equal(await page.locator('.login').count(), 0);
  });

  await step('settings: change policy, only the changed key is PUT', async () => {
    await goto('#/settings');
    await page.waitForSelector('select[name=bonus_return_policy]');
    await page.selectOption('select[name=bonus_return_policy]', 'Independent');
    mock.state.requests.length = 0;
    await page.click('button:has-text("حفظ")');
    await page.waitForSelector('#toasts .toast:has-text("حُفظ 1")');
    const puts = mock.state.requests.filter((r) => r.method === 'PUT');
    assert.equal(puts.length, 1);
    assert.equal(puts[0].path, '/settings/bonus_return_policy');
    assert.equal(puts[0].body.value, 'Independent');
  });

  await step('sync queue: payload visible, discard needs a note', async () => {
    await goto('#/sync');
    await page.waitForSelector('tbody tr');
    await page.click('tbody tr');
    await page.waitForSelector('.modal pre.json');
    assert.ok((await page.locator('.modal pre.json').last().textContent()).includes('customerId'));
    await page.click('.modal .actions button:has-text("تجاهل")');
    await page.waitForSelector('.overlay:nth-of-type(2), .overlay >> nth=1');
    const prompt = page.locator('.overlay').last();
    await prompt.locator('.actions button:has-text("متابعة")').click();
    await prompt.locator('.err:has-text("الحد الأدنى")').waitFor();
    await prompt.locator('textarea').fill('اختبار تجاهل');
    await prompt.locator('.actions button:has-text("متابعة")').click();
    await page.waitForSelector('#toasts .toast:has-text("تم التجاهل")');
    assert.deepEqual(lastReq('POST', '/sync/conflicts/s1/resolve').body, { action: 'discard', note: 'اختبار تجاهل' });
  });

  await step('notifications: unread list and mark all read', async () => {
    await goto('#/notifications');
    await page.waitForSelector('.card:has-text("تنبيه صلاحية الأدوية")');
    await page.click('button:has-text("تعليم الكل كمقروء")');
    await page.waitForSelector('#toasts .toast:has-text("تم")');
  });

  // ───────────── field screens: visits, plans, targets, stocktake, customer map
  await step('sidebar has the new field/stock screens', async () => {
    await goto('#/dashboard');
    const m = await menu();
    for (const t of ['الزيارات', 'خطط الزيارة', 'الأهداف', 'الجرد', 'خريطة العملاء']) assert.ok(m.includes(t), 'menu is missing ' + t);
  });

  await step('visits: list, location filter reaches the API, detail shows location evidence, edit sends only editable fields', async () => {
    await goto('#/visits');
    await page.waitForSelector('tbody tr');
    assert.equal(await page.locator('tbody tr').count(), 2);
    assert.ok((await page.locator('tbody').innerText()).includes('موقع مؤكَّد'));
    await page.selectOption('select[aria-label="الموقع"]', 'NotProvided');
    await page.waitForTimeout(250);
    assert.equal(lastReq('GET', '/visits').query.locationStatus, 'NotProvided');
    await page.selectOption('select[aria-label="الموقع"]', '');
    await page.waitForTimeout(250);
    await page.locator('tbody tr').first().click();
    await page.waitForSelector('.modal .kv');
    const txt = await page.locator('.modal').innerText();
    assert.ok(txt.includes('40 م') && txt.includes('33.31520, 44.36610'), 'location evidence missing: ' + txt);
    assert.equal(await page.locator('.modal a[href*="google.com/maps?q=33.3152,44.3661"]').count(), 1);
    await page.click('.modal .actions button:has-text("تعديل")');
    await page.fill('.modal input[name=outcome]', 'تم الاتفاق على طلب');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('#toasts .toast:has-text("تم")');
    assert.equal(lastReq('PATCH', '/visits/v1').body.outcome, 'تم الاتفاق على طلب');
    assert.ok(!('locationStatus' in lastReq('PATCH', '/visits/v1').body) && !('latitude' in lastReq('PATCH', '/visits/v1').body), 'location must not be editable');
  });

  await step('visit plans: shows done entry, adds a customer (hostile name inert), saves only the open entries', async () => {
    await goto('#/visit-plans');
    await page.waitForSelector('select[aria-label="المندوب"]');
    await page.selectOption('select[aria-label="المندوب"]', 'r1');
    await page.waitForSelector('tbody tr');
    assert.ok((await page.locator('tbody').innerText()).includes('منجزة'));
    assert.equal(lastReq('GET', '/visit-plans').query.representativeId, 'r1');
    await page.fill('input[aria-label="ابحث عن عميل من عملاء المندوب لإضافته"]', '<img');
    await page.waitForSelector('.pick-list button');
    assert.equal(lastReq('GET', '/customers').query.representativeId, 'r1', 'picker must be limited to the rep\'s customers');
    await page.click('.pick-list button');
    await page.waitForFunction(() => document.querySelectorAll('tbody tr').length === 2);
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    await page.fill('input[aria-label="الأولوية"]', '3');
    await page.click('button:has-text("حفظ الخطة")');
    await page.waitForSelector('#toasts .toast:has-text("حُفظت الخطة")');
    const b = lastReq('PUT', '/visit-plans/day').body;
    assert.equal(b.representativeId, 'r1');
    assert.deepEqual(b.items, [{ customerId: 'c2', priority: 3 }]);
    assert.ok(/^\d{4}-\d{2}-\d{2}$/.test(b.date));
  });

  await step('visit plans: priority outside 0-10 is refused in the browser', async () => {
    await page.fill('input[aria-label="الأولوية"]', '11');
    await page.click('button:has-text("حفظ الخطة")');
    await page.waitForSelector('.errbox:has-text("من 0 إلى 10")');
  });

  await step('targets: list, end-before-start and empty targets are refused locally, valid create is sent', async () => {
    await goto('#/targets');
    await page.waitForSelector('tbody tr');
    assert.ok((await page.locator('tbody').innerText()).includes('5,000,000'));
    await page.click('button:has-text("هدف جديد")');
    await page.selectOption('.modal select[name=representativeId]', 'r1');
    await page.fill('.modal input[name=startDate]', '2026-11-30');
    await page.fill('.modal input[name=endDate]', '2026-11-01');
    await page.fill('.modal input[name=targetVisits]', '50');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('.modal .errbox:has-text("تاريخ النهاية قبل البداية")');
    await page.fill('.modal input[name=endDate]', '2026-11-30');
    await page.fill('.modal input[name=startDate]', '2026-11-01');
    await page.fill('.modal input[name=targetVisits]', '');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('.modal .errbox:has-text("هدفاً واحداً")');
    await page.fill('.modal input[name=targetAmount]', '2000000');
    await page.click('.modal .actions button:has-text("حفظ")');
    await page.waitForSelector('#toasts .toast:has-text("تم")');
    const b = lastReq('POST', '/sales-targets').body;
    assert.equal(b.representativeId, 'r1'); assert.equal(b.periodType, 'Monthly'); assert.equal(b.startDate, '2026-11-01'); assert.equal(b.targetAmount, 2000000);
  });

  await step('stocktake: loads system quantities (batches + loose), counts only filled rows, shows the result report', async () => {
    await goto('#/stocktake');
    await page.waitForSelector('select[aria-label="المخزن"]');
    await page.selectOption('select[aria-label="المخزن"]', 'x1');
    await page.click('button:has-text("تحميل أرصدة النظام")');
    await page.waitForSelector('input.count');
    assert.equal(await page.locator('input.count').count(), 4, 'two batches + loose part + a product without batches');
    assert.ok((await page.locator('tbody').innerText()).includes('(بلا تشغيلة)'));
    await page.click('button:has-text("اعتماد الجرد")');
    await page.waitForSelector('.errbox:has-text("لم تُدخل أي كمية")');
    const inputs = page.locator('input.count');
    await inputs.nth(0).fill('58');   // B-1: 60 -> 58
    await inputs.nth(1).fill('30');   // B-2 matches
    await inputs.nth(3).fill('31');   // product 2 (no batches): 30 -> 31
    const diffs = await page.locator('td.diff').allTextContents();
    assert.deepEqual(diffs, ['-2', '0', '', '1']);
    await page.click('button:has-text("اعتماد الجرد")');
    await page.click('.modal .actions button:has-text("اعتماد")');
    await page.waitForSelector('h3:has-text("ADJ-000001")');
    const b = lastReq('POST', '/inventory/stocktake').body;
    assert.equal(b.warehouseId, 'x1');
    assert.deepEqual(b.counts, [{ productId: 'p1', batchId: 'b1', countedQuantity: 58 }, { productId: 'p1', batchId: 'b2', countedQuantity: 30 }, { productId: 'p2', countedQuantity: 31 }]);
    assert.ok((await page.locator('tbody').innerText()).includes('مطابق'), 'matching line is reported as matching');
  });

  await step('customer map: plots customers, hostile name stays text, radius needs both coordinates', async () => {
    await goto('#/customer-map');
    await page.waitForSelector('svg.map-svg circle.dot');
    assert.equal(await page.locator('svg.map-svg circle.dot').count(), 3);
    await page.locator('svg.map-svg circle.dot[data-id="c2"]').click();
    assert.ok((await page.locator('.card[aria-live]').innerText()).includes('<img src=x'), 'hostile name must be shown as text');
    assert.equal(await page.evaluate(() => window.__xss), undefined);
    await page.fill('input[aria-label="خط العرض"]', '33.3');
    await page.click('button:has-text("عرض")');
    await page.waitForSelector('.errbox:has-text("معاً")');
    await page.fill('input[aria-label="خط الطول"]', '44.4');
    await page.click('button:has-text("عرض")');
    await page.waitForSelector('svg.map-svg');
    const r = lastReq('GET', '/customers/map').query;
    assert.equal(r.lat, '33.3'); assert.equal(r.lng, '44.4'); assert.equal(r.radiusM, '5000');
  });

  await step('every route renders without script errors or CSP violations', async () => {
    const routes = ['/dashboard', '/customers', '/customers/c1', '/products', '/orders', '/orders/o1', '/invoices', '/invoices/new', '/invoices/i1', '/returns', '/returns/new', '/payments', '/stock', '/batches', '/batches?tab=near', '/batches?tab=expired',
      '/purchases', '/purchases/new', '/purchases/x1', '/reports', '/reports?r=fa', '/reports?r=ic', '/sync', '/users', '/audit', '/settings', '/notifications', '/companies', '/categories', '/warehouses', '/areas', '/representatives', '/price-lists', '/bonus-rules', '/transfers', '/adjustments', '/visits', '/visit-plans', '/targets', '/stocktake', '/customer-map', '/does-not-exist'];
    for (const r of routes) {
      const before = problems.length;
      await goto('#' + r);
      await page.waitForTimeout(250);
      const filled = await page.evaluate(() => document.getElementById('view').children.length);
      assert.ok(filled > 0, r + ' rendered nothing');
      const shown = await page.locator('#view').innerText();
      assert.ok(!/\[object |undefined|NaN/.test(shown), r + ' shows a rendering artefact: ' + (shown.match(/.{0,30}(\[object |undefined|NaN).{0,30}/) || [''])[0]);
      assert.equal(problems.length, before, r + ' raised: ' + problems.slice(before).join(' | '));
    }
  });

  await step('logout returns to the login form and clears the session', async () => {
    await page.click('button:has-text("خروج")');
    await page.waitForSelector('.login');
    assert.equal(await page.evaluate(() => sessionStorage.getItem('at')), null);
  });

  await step('representative: limited menu, and a forbidden page says so', async () => {
    await login('rep', 'Rep#12345');
    await page.waitForSelector('.shell');
    const m = await menu();
    for (const t of ['العملاء', 'الطلبات', 'المنتجات']) assert.ok(m.includes(t), 'missing ' + t);
    for (const t of ['التقارير', 'المستخدمون', 'الإعدادات', 'الفواتير', 'سجل التدقيق', 'طابور المزامنة']) assert.ok(!m.includes(t), 'must not show ' + t);
    await goto('#/reports');
    await page.waitForSelector('.errbox:has-text("ليست لديك صلاحية")');
    await page.click('button:has-text("خروج")');
  });

  await step('first login with a temporary password forces a password change', async () => {
    await login('newbie', 'Temp#12345');
    await page.waitForSelector('.modal h3:has-text("يجب تغيير كلمة المرور")');
    await page.fill('.modal input[name=currentPassword]', 'Temp#12345');
    await page.fill('.modal input[name=newPassword]', 'short');
    await page.click('.modal .actions button:has-text("تغيير")');
    await page.waitForSelector('.modal .errbox:has-text("أقل من 8")');
    await page.fill('.modal input[name=newPassword]', 'A-much-longer-pass-1');
    await page.click('.modal .actions button:has-text("تغيير")');
    await page.waitForSelector('#toasts .toast:has-text("تم تغيير")');
    assert.deepEqual(lastReq('POST', '/auth/change-password').body, { currentPassword: 'Temp#12345', newPassword: 'A-much-longer-pass-1' });
  });

  await step('no script errors or CSP violations during the whole run', async () => {
    assert.deepEqual(problems, []);
  });

  await browser.close();
  mock.server.close();
  const failed = results.filter((r) => !r.ok);
  console.log(`\n${results.length - failed.length}/${results.length} UI checks passed.`);
  process.exit(failed.length ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

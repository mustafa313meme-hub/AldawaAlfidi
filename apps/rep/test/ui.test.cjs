// Rep app in real Chromium against the mock sync API, including going offline. Run: NODE_PATH=$(npm root -g) node apps/rep/test/ui.test.cjs
const assert = require('node:assert/strict');
const { chromium } = require('playwright');
const { startMock } = require('./mock-rep-api.cjs');
const results = [];
let page;
async function step(name, fn) { try { await fn(); results.push(1); console.log('  PASS  ' + name); } catch (e) { results.push(0); console.log('  VIEW: ' + (await page.locator('#view').innerText().catch(() => '?')).slice(0, 200).replace(/\n/g, ' ')); console.log('  FAIL  ' + name + '\n        ' + String(e.message).split('\n').slice(0, 4).join('\n        ')); } }

(async () => {
  const mock = await startMock(0);
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ locale: 'ar', serviceWorkers: 'allow', geolocation: { latitude: 33.3153, longitude: 44.3662, accuracy: 15 }, permissions: ['geolocation'] });
  page = await ctx.newPage(); page.setDefaultTimeout(7000);
  const problems = [];
  page.on('pageerror', (e) => problems.push('pageerror: ' + e.message));
  page.on('console', (m) => { const t = m.text(); if (m.type() === 'error' && /Content Security Policy|Uncaught|TypeError|ReferenceError/.test(t)) problems.push('console: ' + t); });
  const go = async (h) => { await page.evaluate((x) => { location.hash = x; }, h); await page.waitForTimeout(250); };
  const reqs = (m, p) => mock.state.requests.filter((r) => r.method === m && r.path === p);
  const saved = () => page.waitForSelector('.toast:has-text("حُفظ")');
  const applied = (n) => page.waitForFunction(() => true).then(async () => { for (let i = 0; i < 100 && mock.state.applied.size < n; i++) await page.waitForTimeout(100); assert.ok(mock.state.applied.size >= n, 'server did not receive ' + n + ' ops'); });
  const waitStatus = (txt) => page.waitForSelector(`.syncdot:has-text("${txt}")`, { timeout: 10000 });
  console.log('\nRep app tests (Chromium + mock API)\n');

  await step('login fails with a clear message, then succeeds and the first sync downloads data', async () => {
    await page.goto(mock.url + '/');
    await page.fill('input[aria-label="اسم المستخدم"]', 'rep'); await page.fill('input[aria-label="كلمة المرور"]', 'bad');
    await page.click('button:has-text("دخول")');
    await page.waitForSelector('.login .err:has-text("بيانات الدخول غير صحيحة")');
    await page.fill('input[aria-label="كلمة المرور"]', 'Rep#12345'); await page.click('button:has-text("دخول")');
    await page.waitForSelector('.tile');
    await waitStatus('متزامن');
    assert.ok(reqs('GET', '/sync/pull/customers').length >= 1);
    assert.equal(reqs('GET', '/sync/pull/customers')[0].query.since, undefined, 'first pull is a full download');
    assert.equal(reqs('POST', '/auth/login')[0].body.device.platform, 'web');
    assert.ok(reqs('GET', '/sync/pull/customers')[0].headers['x-device-id']);
  });

  await step('home: today\'s plan lists customers; hostile names stay text', async () => {
    await go('#/');
    await page.waitForSelector('.card.item');
    const t = await page.locator('#view').innerText();
    assert.ok(t.includes('صيدلية الأمل') && t.includes('<img src=x'));
    assert.equal(await page.evaluate(() => window.__xss), undefined);
  });

  await step('customers: Arabic-normalised search (ة/ه) and balance shown', async () => {
    await go('#/customers');
    await page.fill('input[aria-label="بحث"]', 'صيدليه الامل');
    await page.waitForFunction(() => document.querySelectorAll('.card.item').length === 1);
    assert.ok((await page.locator('.card.item').innerText()).includes('22,000'));
  });

  await step('order (online): price from the customer\'s price list, bonus tier preview, queued then applied', async () => {
    await go('#/customers/c1');
    await page.click('a:has-text("طلب جديد")');
    await page.fill('input[aria-label="بحث عن منتج"]', 'بنادول');
    await page.click('.pick');
    await page.fill('input[aria-label="الكمية"]', '25'); await page.press('input[aria-label="الكمية"]', 'Tab');
    const t = await page.locator('.line').innerText();
    assert.ok(t.includes('10,000 × 25 = 250,000') && t.includes('+ 4 بونص'), t);
    await page.click('button:has-text("حفظ الطلب")');
    await saved(); await applied(1);
    const b = reqs('POST', '/sync/push').flatMap((r) => r.body.ops).find((o) => o.type === 'order');
    assert.deepEqual(b.payload, { customerId: 'c1', lines: [{ productId: 'p1', quantity: 25 }], submit: true });
    assert.ok(/^[0-9a-f-]{36}$/.test(b.localId));
  });

  await step('OFFLINE: visit and payment are saved locally, the screen says so, nothing is sent', async () => {
    await ctx.setOffline(true);
    await page.evaluate(() => window.dispatchEvent(new Event('offline')));
    const before = reqs('POST', '/sync/push').length;
    await go('#/visit/new?customerId=c1');
    await page.click('button:has-text("التقاط موقعي")');
    await page.waitForSelector('text=تم التقاط الموقع');
    await page.fill('input[aria-label="النتيجة"]', 'اتفاق مبدئي');
    await page.click('button:has-text("حفظ الزيارة")');
    await saved(); await page.waitForSelector('text=الفواتير غير المسددة');
    await go('#/payment/new?customerId=c1&invoiceId=i1');
    await page.fill('input[aria-label="المبلغ"]', '5000');
    await page.click('button:has-text("حفظ التسديد")');
    await saved();
    await go('#/sync');
    await page.waitForSelector('.card:has-text("بانتظار الإرسال")');
    assert.equal(await page.locator('#offline:not([hidden])').count(), 1);
    assert.equal(reqs('POST', '/sync/push').length, before, 'nothing may be pushed while offline');
  });

  await step('OFFLINE: the app still loads after a reload (service worker) and keeps its data', async () => {
    await page.waitForFunction(() => navigator.serviceWorker.controller !== null, null, { timeout: 8000 });
    await page.reload();
    await page.waitForSelector('#view .card');
    await go('#/customers');
    await page.waitForSelector('.card.item');
    assert.ok((await page.locator('#view').innerText()).includes('صيدلية الأمل'));
  });

  await step('back ONLINE: queued operations are pushed once each, payload is exactly what was entered', async () => {
    await ctx.setOffline(false);
    await page.evaluate(() => window.dispatchEvent(new Event('online')));
    await applied(3);
    const ops = reqs('POST', '/sync/push').flatMap((r) => r.body.ops);
    const visit = ops.find((o) => o.type === 'visit'); const pay = ops.find((o) => o.type === 'payment');
    assert.equal(visit.payload.outcome, 'اتفاق مبدئي'); assert.equal(visit.payload.latitude, 33.3153); assert.equal(visit.payload.accuracyM, 15);
    assert.ok(visit.payload.startTime <= visit.payload.endTime);
    assert.deepEqual([pay.payload.amount, pay.payload.invoiceId, pay.payload.method], [5000, 'i1', 'Cash']);
    const ids = ops.map((o) => o.localId);
    assert.equal(new Set(ids).size, ids.length, 'an applied operation must never be sent twice');
  });

  await step('a Conflict from the server is shown to the rep, kept, and can be hidden', async () => {
    await go('#/payment/new?customerId=c1');
    await page.fill('input[aria-label="المبلغ"]', '777');
    await page.click('button:has-text("حفظ التسديد")');
    await saved();
    await go('#/sync');
    await page.waitForSelector('.card:has-text("بانتظار مراجعة الإدارة")');
    assert.ok((await page.locator('#view').innerText()).includes('الفاتورة غير مفتوحة'));
    assert.ok(await page.locator('.syncdot.bad').count());
    await page.click('button:has-text("إخفاء من جهازي")'); await page.click('.modal button:has-text("إخفاء")');
    await page.waitForFunction(() => !document.body.innerText.includes('الفاتورة غير مفتوحة'));
  });

  await step('return: choose invoice (online), policy preview, queued', async () => {
    await go('#/return/new?customerId=c1');
    await page.click('.pick:has-text("INV-000001")');
    await page.fill('input[aria-label="كمية مباعة مرتجعة"]', '2');
    await page.waitForSelector('text=البونص المطلوب إرجاعه: 2');
    await page.click('button:has-text("حفظ المردود")');
    await saved(); await applied(5);
    const r = reqs('POST', '/sync/push').flatMap((x) => x.body.ops).find((o) => o.type === 'return');
    assert.deepEqual(r.payload.items, [{ invoiceItemId: 'ii1', soldQuantity: 2, bonusQuantity: 0, condition: 'Valid' }]);
  });

  await step('visit validation: missing location is refused when the server setting requires it', async () => {
    await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('silver-rep'); r.onsuccess = () => { const tx = r.result.transaction('settings', 'readwrite'); tx.objectStore('settings').put({ key: 'require_location_for_visit', value: true }); tx.oncomplete = res; }; }));
    await go('#/visit/new?customerId=c1');
    await page.click('button:has-text("حفظ الزيارة")');
    await page.waitForSelector('.errbox:has-text("الموقع مطلوب")');
  });

  await step('blocked customer cannot get an order; session survives a reload; logout wipes the device', async () => {
    await go('#/order/new?customerId=c3');
    await page.waitForSelector('.errbox:has-text("غير فعّال")');
    await go('#/more');
    await page.click('button:has-text("تسجيل الخروج")');
    await page.waitForSelector('.login');
    assert.equal(await page.evaluate(() => new Promise((res) => { const r = indexedDB.open('silver-rep'); r.onsuccess = () => { const q = r.result.transaction('customers').objectStore('customers').count(); q.onsuccess = () => res(q.result); }; })), 0);
  });

  await step('no script errors or CSP violations', async () => { assert.deepEqual(problems, []); });
  await browser.close(); mock.server.close();
  const bad = results.filter((x) => !x).length;
  console.log(`\n${results.length - bad}/${results.length} rep app checks passed.`);
  process.exit(bad ? 1 : 0);
})().catch((e) => { console.error(e); process.exit(2); });

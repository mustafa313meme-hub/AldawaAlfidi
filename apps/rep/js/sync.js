// Offline sync (protocol: docs/PHASE_8_STATUS.md). Push the outbox first, then pull deltas. One run at a time.
import { api } from './api.js';
import { dbAll, dbBatch, dbClear, dbDelete, dbGet, dbPut, getMeta, setMeta } from './db.js';
import { uuid } from './dom.js';

const PULL = ['settings', 'customers', 'removedCustomers', 'balances', 'categories', 'companies', 'products', 'bonusRules', 'priceLists', 'priceListItems', 'visitPlans', 'openInvoices'];
const SETTLED = new Set(['Applied', 'Discarded']);
const RETRYABLE = new Set(['pending', 'Failed', 'Processing']);
const state = { running: false, lastOkAt: null, error: null, pending: 0, problems: 0, skewMs: 0 };
export const syncState = () => ({ ...state });
const emit = () => window.dispatchEvent(new CustomEvent('sync-state', { detail: syncState() }));

export async function refreshCounts() {
  const ops = await dbAll('outbox');
  state.pending = ops.filter((o) => RETRYABLE.has(o.status)).length;
  state.problems = ops.filter((o) => o.status === 'Conflict' || o.status === 'Rejected').length;
  emit();
}

/** Queue an operation. It is stored first (never lost), then a sync is attempted in the background. */
export async function enqueue(type, payload, { summary, customerId } = {}) {
  const op = { localId: uuid(), type, payload, createdAt: new Date().toISOString(), status: 'pending', attempts: 0, summary: summary || '', customerId: customerId || null, error: null, serverId: null };
  await dbPut('outbox', op);
  await refreshCounts();
  setTimeout(() => { syncNow().catch(() => {}); }, 50);
  return op;
}

export async function retryOp(localId) { const o = await dbGet('outbox', localId); if (o && (o.status === 'Failed' || o.status === 'Processing')) { o.status = 'pending'; await dbPut('outbox', o); } return syncNow(); }
/** The rep gives up on an operation the server did not accept. Nothing was applied on the server, so dropping it locally is safe. */
export async function dismissOp(localId) { await dbDelete('outbox', localId); await refreshCounts(); }

// ───────────── push
async function pushOutbox() {
  for (let round = 0; round < 20; round++) {
    const todo = (await dbAll('outbox')).filter((o) => RETRYABLE.has(o.status)).sort((a, b) => a.createdAt.localeCompare(b.createdAt)).slice(0, 100);
    if (!todo.length) return;
    const { data } = await api('POST', '/sync/push', { body: { ops: todo.map((o) => ({ localId: o.localId, type: o.type, clientCreatedAt: o.createdAt, payload: o.payload })) } });
    let progressed = false;
    const byId = new Map(todo.map((o) => [o.localId, o]));
    for (const r of data.results) {
      const o = byId.get(r.localId);
      if (!o) continue;
      o.attempts += 1;
      o.status = r.status === 'Processing' ? 'Processing' : r.status;
      o.serverId = r.serverId || o.serverId;
      o.error = r.error || null;
      o.syncedAt = new Date().toISOString();
      if (r.status !== 'Processing' && r.status !== 'Failed') progressed = true;
      await dbPut('outbox', o);
    }
    await refreshCounts();
    if (!progressed) return; // only transient states left: try again on the next sync
  }
}

// ───────────── pull
async function pullEntity(name) {
  const since = await getMeta('since.' + name);
  let cursor; let firstTime = null;
  const seen = [];
  for (let page = 0; page < 500; page++) {
    const { data } = await api('GET', `/sync/pull/${name}`, { query: { since, cursor, limit: 500 } });
    if (!firstTime) firstTime = data.serverTime;
    await apply(name, data.items);
    seen.push(...(name === 'priceLists' ? data.items : []));
    if (!data.nextCursor) break;
    cursor = data.nextCursor;
  }
  await setMeta('since.' + name, firstTime);
  return seen;
}

async function apply(name, items) {
  switch (name) {
    case 'customers': return dbBatch('customers', items.map((x) => ['put', x]));
    case 'removedCustomers': {
      await dbBatch('customers', items.map((id) => ['delete', id]));
      await dbBatch('balances', items.map((id) => ['delete', id]));
      const inv = (await dbAll('openInvoices')).filter((i) => items.includes(i.customerId));
      return dbBatch('openInvoices', inv.map((i) => ['delete', i.id]));
    }
    case 'balances': return dbBatch('balances', items.map((x) => ['put', x]));
    case 'products': case 'categories': case 'companies': case 'bonusRules': case 'visitPlans':
      return dbBatch(name, items.map((x) => ['put', x]));
    case 'priceLists': await dbClear('priceLists'); return dbBatch('priceLists', items.map((x) => ['put', x])); // the server always sends the complete set
    case 'priceListItems': return dbBatch('priceListItems', items.map((x) => ['put', { ...x, key: `${x.priceListId}:${x.productId}` }]));
    case 'openInvoices': return dbBatch('openInvoices', items.map((x) => (x.status !== 'Confirmed' || x.remainingAmount <= 0 ? ['delete', x.id] : ['put', x])));
    case 'settings': return dbBatch('settings', items.map((x) => ['put', x]));
    default: return undefined;
  }
}

/** priceLists[].itemCount differs from what we hold: download that list's items completely and drop the stale ones. */
async function verifyPriceItems(lists) {
  const local = await dbAll('priceListItems');
  const bad = lists.filter((l) => local.filter((i) => i.priceListId === l.id).length !== l.itemCount);
  if (!bad.length) return;
  await dbClear('priceListItems');
  await setMeta('since.priceListItems', undefined);
  await pullEntity('priceListItems');
}

async function pruneLocal() {
  const cutoff = new Date(Date.now() - 2 * 86_400_000).toISOString().slice(0, 10);
  const plans = (await dbAll('visitPlans')).filter((p) => String(p.planDate).slice(0, 10) < cutoff);
  await dbBatch('visitPlans', plans.map((p) => ['delete', p.id]));
  const week = new Date(Date.now() - 7 * 86_400_000).toISOString();
  const done = (await dbAll('outbox')).filter((o) => SETTLED.has(o.status) && (o.syncedAt || o.createdAt) < week);
  await dbBatch('outbox', done.map((o) => ['delete', o.localId]));
}

async function checkClock() {
  try {
    const t0 = Date.now();
    const res = await fetch((window.APP_CONFIG?.apiBase || '/api/v1') + '/sync/time');
    const b = await res.json();
    state.skewMs = new Date(b.data.serverTime).getTime() - (t0 + Date.now()) / 2;
  } catch { /* offline */ }
}

let inflight = null;
/** Push then pull. Single-flight: a second call while running joins the first. Returns {ok, error}. */
export function syncNow() {
  if (inflight) return inflight;
  inflight = (async () => {
    state.running = true; state.error = null; emit();
    try {
      await pushOutbox();
      let lists = [];
      for (const e of PULL) { const r = await pullEntity(e); if (e === 'priceLists') lists = r; }
      await verifyPriceItems(lists);
      await pruneLocal();
      await checkClock();
      state.lastOkAt = new Date().toISOString();
      await setMeta('lastOkAt', state.lastOkAt);
      return { ok: true };
    } catch (e) {
      state.error = e.network ? 'لا يوجد اتصال — ستُرسل العمليات تلقائياً عند عودة الشبكة' : (e.message || 'فشلت المزامنة');
      state.errorCode = e.code || null;
      return { ok: false, error: e };
    } finally {
      state.running = false; inflight = null;
      await refreshCounts();
    }
  })();
  return inflight;
}

let timer = null;
export function startAutoSync() {
  getMeta('lastOkAt').then((v) => { if (v) { state.lastOkAt = v; emit(); } });
  refreshCounts();
  window.addEventListener('online', () => { syncNow(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible' && navigator.onLine) syncNow(); });
  clearInterval(timer);
  timer = setInterval(() => { if (navigator.onLine && document.visibilityState === 'visible') syncNow(); }, 120_000);
  if (navigator.onLine) syncNow();
}

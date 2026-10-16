// IndexedDB wrapper. Everything the rep needs offline lives here; the outbox holds operations until the server confirms them.
const NAME = 'silver-rep';
const VERSION = 1;
export const STORES = {
  meta: 'key', customers: 'id', balances: 'customerId', products: 'id', categories: 'id', companies: 'id', bonusRules: 'id',
  priceLists: 'id', priceListItems: 'key', visitPlans: 'id', openInvoices: 'id', settings: 'key', outbox: 'localId',
};

let dbp = null;
function open() {
  if (!dbp) {
    dbp = new Promise((resolve, reject) => {
      const req = indexedDB.open(NAME, VERSION);
      req.onupgradeneeded = () => { for (const [s, k] of Object.entries(STORES)) if (!req.result.objectStoreNames.contains(s)) req.result.createObjectStore(s, { keyPath: k }); };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => { dbp = null; reject(req.error); };
    });
  }
  return dbp;
}
const wrap = (req) => new Promise((resolve, reject) => { req.onsuccess = () => resolve(req.result); req.onerror = () => reject(req.error); });
async function store(name, mode = 'readonly') { return (await open()).transaction(name, mode).objectStore(name); }

export const dbGet = async (s, key) => wrap((await store(s)).get(key));
export const dbAll = async (s) => wrap((await store(s)).getAll());
export const dbCount = async (s) => wrap((await store(s)).count());
export const dbPut = async (s, obj) => wrap((await store(s, 'readwrite')).put(obj));
export const dbDelete = async (s, key) => wrap((await store(s, 'readwrite')).delete(key));
export const dbClear = async (s) => wrap((await store(s, 'readwrite')).clear());

/** One transaction for a batch of writes (fast and atomic). ops: [['put', obj] | ['delete', key]] */
export async function dbBatch(s, ops) {
  if (!ops.length) return;
  const db = await open();
  await new Promise((resolve, reject) => {
    const tx = db.transaction(s, 'readwrite');
    const st = tx.objectStore(s);
    for (const [op, v] of ops) (op === 'put' ? st.put(v) : st.delete(v));
    tx.oncomplete = resolve; tx.onerror = () => reject(tx.error); tx.onabort = () => reject(tx.error);
  });
}

export const getMeta = async (key) => { const r = await dbGet('meta', key); return r ? r.value : undefined; };
export const setMeta = (key, value) => dbPut('meta', { key, value });

/** Remove every local copy of server data and settings. The outbox is kept unless `all` is true. */
export async function wipe({ all = false } = {}) {
  for (const s of Object.keys(STORES)) if (all || s !== 'outbox') await dbClear(s);
}

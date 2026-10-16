// API client: JSON envelope handling, bearer token, single-flight refresh on 401.

const BASE = (window.APP_CONFIG && window.APP_CONFIG.apiBase) || '/api/v1';

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.message) || `خطأ ${status}`);
    this.status = status;
    this.code = body && body.code;
    this.details = body && body.details;
  }
}

let access = sessionStorage.getItem('at');
let refreshToken = sessionStorage.getItem('rt');
let refreshing = null;
let onLogout = () => {};

export const setLogoutHandler = (fn) => { onLogout = fn; };
export const isLoggedIn = () => !!access;

function saveTokens(a, r) {
  access = a; refreshToken = r;
  if (a) { sessionStorage.setItem('at', a); sessionStorage.setItem('rt', r); } else { sessionStorage.removeItem('at'); sessionStorage.removeItem('rt'); }
}

export function logout() {
  const rt = refreshToken;
  if (access) fetch(BASE + '/auth/logout', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + access }, body: '{}' }).catch(() => {});
  saveTokens(null, null);
  void rt;
  onLogout();
}

export async function login(identifier, password) {
  const res = await fetch(BASE + '/auth/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ identifier, password }) });
  const body = await res.json().catch(() => null);
  if (!res.ok) throw new ApiError(res.status, body);
  saveTokens(body.data.accessToken, body.data.refreshToken);
  return body.data;
}

async function doRefresh() {
  if (!refreshToken) throw new ApiError(401, { message: 'انتهت الجلسة' });
  if (!refreshing) {
    refreshing = fetch(BASE + '/auth/refresh', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ refreshToken }) })
      .then(async (r) => { const b = await r.json().catch(() => null); if (!r.ok) throw new ApiError(r.status, b); saveTokens(b.data.accessToken, b.data.refreshToken); })
      .finally(() => { refreshing = null; });
  }
  return refreshing;
}

function qs(query) {
  const p = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') p.set(k, String(v));
  const s = p.toString();
  return s ? '?' + s : '';
}

async function raw(method, path, { body, query, headers } = {}, retry = true) {
  const res = await fetch(BASE + path + qs(query), {
    method,
    headers: { ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(access ? { authorization: 'Bearer ' + access } : {}), ...(headers || {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (res.status === 401 && retry && refreshToken) {
    try { await doRefresh(); } catch { saveTokens(null, null); onLogout(); throw new ApiError(401, { message: 'انتهت الجلسة، سجّل الدخول من جديد' }); }
    return raw(method, path, { body, query, headers }, false);
  }
  return res;
}

/** Returns {data, meta}. Throws ApiError with the server's Arabic message and details. */
export async function api(method, path, opts) {
  const res = await raw(method, path, opts);
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON */ }
  if (!res.ok) {
    if (res.status === 401) { saveTokens(null, null); onLogout(); }
    throw new ApiError(res.status, body);
  }
  return { data: body ? body.data : null, meta: body ? body.meta : null, message: body ? body.message : null };
}

/** Download a file (CSV export) with the bearer token. */
export async function download(path, query, filename) {
  const res = await raw('GET', path, { query });
  if (!res.ok) { const b = await res.json().catch(() => null); throw new ApiError(res.status, b); }
  const blob = await res.blob();
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url; a.download = filename;
  document.body.append(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 5000);
}

const lookupCache = new Map();
/** Options for selects: cached per endpoint for the page lifetime. */
// pageSize 100 is the API's maximum for paginated lists (companies, representatives, users...); 200 would be rejected with a 400
export function lookup(endpoint, label, { query = { pageSize: 100 }, value = 'id' } = {}) {
  const key = endpoint + JSON.stringify(query);
  if (!lookupCache.has(key)) {
    lookupCache.set(key, api('GET', endpoint, { query }).then(({ data }) => (Array.isArray(data) ? data : []).map((r) => ({ value: r[value], label: typeof label === 'function' ? label(r) : r[label] }))).catch((e) => { lookupCache.delete(key); throw e; }));
  }
  return lookupCache.get(key);
}
export const clearLookups = () => lookupCache.clear();

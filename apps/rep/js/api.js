// API client for the rep app: bearer token, silent refresh, device headers. A network failure is NOT a logout (the rep works offline all day).
const CFG = window.APP_CONFIG || {};
const BASE = CFG.apiBase || '/api/v1';
export const APP_VERSION = CFG.appVersion || '1.0.0';

export class ApiError extends Error {
  constructor(status, body) {
    super((body && body.message) || (status ? `خطأ ${status}` : 'لا يوجد اتصال بالخادم'));
    this.status = status; this.code = body && body.code; this.details = body && body.details; this.network = !status;
  }
}

const ls = {
  get: (k) => { try { return localStorage.getItem(k); } catch { return null; } },
  set: (k, v) => { try { if (v === null) localStorage.removeItem(k); else localStorage.setItem(k, v); } catch { /* private mode: session lives in memory only */ } },
};
let access = ls.get('rep.at');
let refreshToken = ls.get('rep.rt');
let refreshing = null;
let onLogout = () => {};
export const setLogoutHandler = (fn) => { onLogout = fn; };
export const hasSession = () => !!refreshToken || !!access;

export function deviceId() {
  let d = ls.get('rep.device');
  if (!d) { d = (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random().toString(16).slice(2)); ls.set('rep.device', d); }
  return d;
}

function saveTokens(a, r) { access = a; refreshToken = r; ls.set('rep.at', a); ls.set('rep.rt', r); }
export function clearSession() { saveTokens(null, null); }

const baseHeaders = () => ({ 'x-device-id': deviceId(), 'x-platform': 'web', 'x-app-version': APP_VERSION });

async function send(method, path, { body, query, headers } = {}) {
  const qs = new URLSearchParams();
  for (const [k, v] of Object.entries(query || {})) if (v !== undefined && v !== null && v !== '') qs.set(k, String(v));
  let res;
  try {
    res = await fetch(BASE + path + (qs.toString() ? '?' + qs : ''), {
      method, headers: { ...baseHeaders(), ...(body !== undefined ? { 'content-type': 'application/json' } : {}), ...(access ? { authorization: 'Bearer ' + access } : {}), ...(headers || {}) },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch { throw new ApiError(0, null); }
  return res;
}

async function parse(res) {
  const text = await res.text();
  let body = null;
  try { body = text ? JSON.parse(text) : null; } catch { /* not JSON (captive portal, proxy error page) */ }
  if (!res.ok) throw new ApiError(res.status, body);
  if (body === null && text) throw new ApiError(0, { message: 'ردّ غير متوقع من الشبكة' });
  return body;
}

async function doRefresh() {
  if (!refreshToken) throw new ApiError(401, { message: 'انتهت الجلسة' });
  if (!refreshing) {
    refreshing = (async () => {
      const res = await send('POST', '/auth/refresh', { body: { refreshToken } });
      const b = await parse(res);
      saveTokens(b.data.accessToken, b.data.refreshToken);
    })().finally(() => { refreshing = null; });
  }
  return refreshing;
}

/** Returns {data, meta}. Throws ApiError (`network: true` when the server could not be reached). */
export async function api(method, path, opts, retry = true) {
  let res = await send(method, path, opts);
  if (res.status === 401 && retry && refreshToken) {
    try { await doRefresh(); } catch (e) {
      if (e.network) throw e; // offline: keep the session
      clearSession(); onLogout(); throw new ApiError(401, { message: 'انتهت الجلسة، سجّل الدخول من جديد' });
    }
    res = await send(method, path, opts);
  }
  const body = await parse(res).catch((e) => { if (e.status === 401) { clearSession(); onLogout(); } throw e; });
  return { data: body ? body.data : null, meta: body ? body.meta : null, message: body ? body.message : null };
}

export async function login(identifier, password) {
  const res = await send('POST', '/auth/login', { body: { identifier, password, device: { deviceId: deviceId(), platform: 'web', appVersion: APP_VERSION, model: String(navigator.userAgent || '').slice(0, 100) } } });
  const b = await parse(res);
  saveTokens(b.data.accessToken, b.data.refreshToken);
  return b.data;
}

export function logoutRemote() {
  if (access) send('POST', '/auth/logout', { body: {} }).catch(() => {});
  clearSession();
}

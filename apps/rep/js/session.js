// Who is signed in (cached so the app also starts offline) + permission helper.
import { api } from './api.js';

let me = null;
const read = () => { try { return JSON.parse(localStorage.getItem('rep.me') || 'null'); } catch { return null; } };
const write = (v) => { try { if (v) localStorage.setItem('rep.me', JSON.stringify(v)); else localStorage.removeItem('rep.me'); } catch { /* ignore */ } };

/** Online: refresh from the server. Offline: use the cached profile. Throws only when the server says the session is invalid. */
export async function loadMe() {
  try { me = (await api('GET', '/auth/me')).data; write(me); } catch (e) {
    if (!e.network) throw e;
    me = read();
    if (!me) throw e;
  }
  return me;
}
export const getMe = () => me;
export const forgetMe = () => { me = null; write(null); };
export const can = (perm) => !!me && (me.role === 'super_admin' || (me.permissions || []).includes(perm));

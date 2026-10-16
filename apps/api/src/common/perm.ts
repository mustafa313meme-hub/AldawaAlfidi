import { AuthUser } from './decorators';

export const can = (u: AuthUser, perm: string): boolean => u.isSuperAdmin || u.permissions.includes(perm);

/** Business timezone (Iraq). Visit dates are calendar days in this zone, not UTC. */
export const APP_TZ = 'Asia/Baghdad';
export const localDate = (d: Date): string => new Intl.DateTimeFormat('en-CA', { timeZone: APP_TZ }).format(d); // YYYY-MM-DD

/** Iraq has no daylight saving time, so Baghdad is a fixed UTC+3. */
export const APP_UTC_OFFSET = '+03:00';
/** Start (00:00 Baghdad) of a YYYY-MM-DD calendar day, as an instant. */
export const dayStart = (ymd: string): Date => new Date(`${ymd.slice(0, 10)}T00:00:00.000${APP_UTC_OFFSET}`);
/** End (23:59:59.999 Baghdad) of a YYYY-MM-DD calendar day. */
export const dayEnd = (ymd: string): Date => new Date(`${ymd.slice(0, 10)}T23:59:59.999${APP_UTC_OFFSET}`);

/** Pure sync helpers (no database): classification of failures and delta-sync cursors. */

export type OpOutcome = 'Conflict' | 'Rejected' | 'Failed';

/**
 * Malformed or not permitted: nothing a manager can fix by changing data. Everything else that is a business
 * "no" (customer reassigned, product deactivated, price below minimum, invoice already paid...) is a CONFLICT:
 * kept with its full payload for a manager to retry or discard. Nothing is ever silently dropped (SRS §36).
 */
export const REJECT_CODES = new Set(['VALIDATION_ERROR', 'FORBIDDEN', 'UNAUTHORIZED', 'DEVICE_REQUIRED', 'DEVICE_BLOCKED', 'NOT_A_REPRESENTATIVE', 'UNKNOWN_OPERATION', 'LOCAL_ID_COLLISION']);
export const MAX_ATTEMPTS = 5;

export function classifyFailure(err: { status?: number; code?: string } | undefined, attemptsSoFar: number): { outcome: OpOutcome; code: string } {
  const status = typeof err?.status === 'number' ? err.status : 0;
  const code = err?.code ?? 'INTERNAL_ERROR';
  if (status >= 400 && status < 500) return { outcome: REJECT_CODES.has(code) ? 'Rejected' : 'Conflict', code };
  // 5xx / unknown: transient. Retried on the next push, until it has failed too many times.
  return attemptsSoFar + 1 >= MAX_ATTEMPTS ? { outcome: 'Conflict', code: 'TOO_MANY_FAILURES' } : { outcome: 'Failed', code };
}

export const CURSOR_OVERLAP_MS = 60_000;

/** Opaque keyset cursor over (updatedAt, id). */
export function encodeCursor(updatedAt: Date, id: string): string {
  return Buffer.from(`${updatedAt.toISOString()}|${id}`).toString('base64url');
}

export function decodeCursor(c: string): { t: Date; id: string } {
  const raw = Buffer.from(c, 'base64url').toString('utf8');
  const i = raw.indexOf('|');
  const t = new Date(raw.slice(0, i));
  if (i < 0 || Number.isNaN(t.getTime())) throw new RangeError('invalid cursor');
  return { t, id: raw.slice(i + 1) };
}

/** Delta start: a little before `since`, so rows committed late (long transactions) are not missed. Clients upsert by id, so repeats are harmless. */
export function deltaStart(since: string | undefined): Date | undefined {
  if (!since) return undefined;
  const t = new Date(since);
  if (Number.isNaN(t.getTime())) throw new RangeError('invalid since');
  return new Date(t.getTime() - CURSOR_OVERLAP_MS);
}

/** Take one page from `limit + 1` rows fetched in (updatedAt, id) order. */
export function pageOf<T extends { updatedAt: Date; id: string }>(rows: T[], limit: number): { items: T[]; nextCursor: string | null } {
  if (rows.length <= limit) return { items: rows, nextCursor: null };
  const items = rows.slice(0, limit);
  const last = items[items.length - 1];
  return { items, nextCursor: encodeCursor(last.updatedAt, last.id) };
}

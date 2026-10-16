import { MAX_ATTEMPTS, classifyFailure, decodeCursor, deltaStart, encodeCursor, pageOf } from './sync-logic';

describe('classifyFailure', () => {
  it('business refusals become conflicts for a manager', () => {
    for (const code of ['CUSTOMER_NOT_ASSIGNED', 'INVOICE_NOT_OPEN', 'BELOW_MIN_PRICE', 'SOLD_EXCEEDS_RETURNABLE', 'CUSTOMER_NOT_ACTIVE', 'INVALID_PRODUCT', 'NOT_FOUND', 'VISIT_TOO_FAR']) {
      expect(classifyFailure({ status: 422, code }, 0).outcome).toBe('Conflict');
    }
  });
  it('malformed or forbidden operations are rejected', () => {
    for (const code of ['VALIDATION_ERROR', 'FORBIDDEN', 'DEVICE_BLOCKED', 'NOT_A_REPRESENTATIVE']) {
      expect(classifyFailure({ status: 403, code }, 0).outcome).toBe('Rejected');
    }
  });
  it('server errors are retried, then escalate to a conflict', () => {
    expect(classifyFailure({ status: 500, code: 'X' }, 0).outcome).toBe('Failed');
    expect(classifyFailure(undefined, 1).outcome).toBe('Failed');
    const last = classifyFailure({ status: 500 }, MAX_ATTEMPTS - 1);
    expect(last.outcome).toBe('Conflict');
    expect(last.code).toBe('TOO_MANY_FAILURES');
  });
});

describe('cursors', () => {
  it('round-trips (updatedAt, id)', () => {
    const t = new Date('2026-10-09T10:20:30.123Z');
    const c = decodeCursor(encodeCursor(t, 'abc|def'));
    expect(c.t.toISOString()).toBe(t.toISOString());
    expect(c.id).toBe('abc|def');
  });
  it('rejects garbage', () => {
    expect(() => decodeCursor('not-a-cursor')).toThrow();
    expect(() => decodeCursor(Buffer.from('nodate|x').toString('base64url'))).toThrow();
  });
  it('delta start is slightly before since; empty since means full sync', () => {
    expect(deltaStart(undefined)).toBe(undefined);
    expect(deltaStart('2026-10-09T10:00:00.000Z')?.toISOString()).toBe('2026-10-09T09:59:00.000Z');
    expect(() => deltaStart('garbage')).toThrow();
  });
});

describe('pageOf', () => {
  const rows = [1, 2, 3, 4].map((n) => ({ id: `id${n}`, updatedAt: new Date(2026, 0, n) }));
  it('returns everything and no cursor when it fits', () => {
    expect(pageOf(rows.slice(0, 3), 3)).toEqual({ items: rows.slice(0, 3), nextCursor: null });
  });
  it('cuts at the limit and points at the last item returned', () => {
    const p = pageOf(rows, 3);
    expect(p.items.length).toBe(3);
    const c = decodeCursor(p.nextCursor as string);
    expect(c.id).toBe('id3');
  });
});

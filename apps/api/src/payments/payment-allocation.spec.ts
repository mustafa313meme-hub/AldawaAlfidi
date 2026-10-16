import { allocatePayment } from './payment-allocation';

const d = (s: string) => new Date(s);
const open = [
  { id: 'new', remaining: 500, date: d('2026-10-05') },
  { id: 'old', remaining: 300, date: d('2026-09-01') },
  { id: 'mid', remaining: 400, date: d('2026-09-20') },
];

describe('allocatePayment', () => {
  it('settles the oldest invoices first (FIFO)', () => {
    const r = allocatePayment(600, open);
    expect(r.allocations).toEqual([{ invoiceId: 'old', amount: 300 }, { invoiceId: 'mid', amount: 300 }]);
    expect(r.unallocated).toBe(0);
  });
  it('pays a chosen invoice first, then the oldest', () => {
    const r = allocatePayment(700, open, 'new');
    expect(r.allocations).toEqual([{ invoiceId: 'new', amount: 500 }, { invoiceId: 'old', amount: 200 }]);
  });
  it('a payment smaller than the preferred invoice is a partial payment of it', () => {
    const r = allocatePayment(100, open, 'mid');
    expect(r.allocations).toEqual([{ invoiceId: 'mid', amount: 100 }]);
    expect(r.unallocated).toBe(0);
  });
  it('overpayment leaves the rest on account', () => {
    const r = allocatePayment(5_000, open);
    expect(r.allocated).toBe(1_200);
    expect(r.unallocated).toBe(3_800);
  });
  it('no open invoices: everything stays on account', () => {
    expect(allocatePayment(1_000, [])).toEqual({ allocations: [], allocated: 0, unallocated: 1_000 });
  });
  it('auto=false allocates only to the chosen invoice', () => {
    const r = allocatePayment(700, open, 'new', false);
    expect(r.allocations).toEqual([{ invoiceId: 'new', amount: 500 }]);
    expect(r.unallocated).toBe(200);
  });
  it('skips invoices with nothing remaining', () => {
    const r = allocatePayment(100, [{ id: 'paid', remaining: 0, date: d('2026-01-01') }, { id: 'x', remaining: 50, date: d('2026-02-01') }]);
    expect(r.allocations).toEqual([{ invoiceId: 'x', amount: 50 }]);
  });
  it('breaks date ties by id so the result is deterministic', () => {
    const r = allocatePayment(10, [{ id: 'b', remaining: 10, date: d('2026-01-01') }, { id: 'a', remaining: 10, date: d('2026-01-01') }]);
    expect(r.allocations[0].invoiceId).toBe('a');
  });
  it('never allocates more than the payment or the remaining amount', () => {
    for (const amt of [1, 299, 300, 301, 1_199, 1_200, 1_201, 99_999]) {
      const r = allocatePayment(amt, open);
      expect(r.allocated + r.unallocated).toBe(amt);
      expect(r.allocations.every((a) => a.amount <= open.find((o) => o.id === a.invoiceId)!.remaining)).toBe(true);
    }
  });
  it('rejects non-positive or fractional amounts and unknown preferred invoice', () => {
    expect(() => allocatePayment(0, open)).toThrow();
    expect(() => allocatePayment(-5, open)).toThrow();
    expect(() => allocatePayment(1.5, open)).toThrow();
    expect(() => allocatePayment(100, open, 'ghost')).toThrow();
  });
});

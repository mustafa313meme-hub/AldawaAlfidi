import { BatchRow, distributeReturn, fefoOrder, planFefo, splitAllocations, weightedAverageCost } from './allocation';

const d = (s: string) => new Date(s);
const today = d('2026-10-08');
const b = (id: string, exp: string | null, quantity: number, cost = 100): BatchRow => ({ id, batchNumber: id, expiryDate: exp ? d(exp) : null, quantity, cost });

describe('FEFO planning', () => {
  it('takes the earliest expiry first', () => {
    const r = planFefo([b('late', '2027-06-01', 10), b('early', '2026-12-01', 10)], 20, 12, today);
    expect(r.ok).toBe(true);
    expect(r.allocs.map((a) => [a.batchId, a.qty])).toEqual([['early', 10], ['late', 2]]);
  });
  it('never sells an expired batch', () => {
    const r = planFefo([b('old', '2026-09-01', 50), b('ok', '2027-01-01', 5)], 55, 10, today);
    expect(r.ok).toBe(false);
    expect(r.sellable).toBe(5);
    expect(r.expired).toBe(50);
  });
  it('a batch expiring today is still sellable', () => {
    expect(planFefo([b('x', '2026-10-08', 5)], 5, 5, today).ok).toBe(true);
  });
  it('batches without expiry come after those with expiry', () => {
    const r = planFefo([b('none', null, 10), b('dated', '2030-01-01', 10)], 20, 15, today);
    expect(r.allocs.map((a) => a.batchId)).toEqual(['dated', 'none']);
  });
  it('uses unbatched stock after batches', () => {
    const r = planFefo([b('a', '2027-01-01', 4)], 10, 7, today);
    expect(r.allocs.map((a) => [a.batchId, a.qty])).toEqual([['a', 4], [null, 3]]);
    expect(r.unbatched).toBe(6);
  });
  it('reports shortfall without allocating', () => {
    const r = planFefo([b('a', '2027-01-01', 4)], 4, 5, today);
    expect(r.ok).toBe(false);
    expect(r.allocs).toEqual([]);
  });
  it('write-off may take expired batches', () => {
    expect(planFefo([b('old', '2026-09-01', 50)], 50, 50, today, true).ok).toBe(true);
  });
  it('detects corrupted stock (batches exceed total)', () => {
    expect(() => planFefo([b('a', null, 10)], 5, 1, today)).toThrow();
  });
  it('fefoOrder is stable on equal expiry by creation time', () => {
    const rows = [{ id: 'b', expiryDate: d('2027-01-01'), createdAt: d('2026-02-01') }, { id: 'a', expiryDate: d('2027-01-01'), createdAt: d('2026-01-01') }];
    expect(fefoOrder(rows).map((r) => r.id)).toEqual(['a', 'b']);
  });
});

describe('splitAllocations', () => {
  it('sold units take the earliest batches, bonus gets the rest', () => {
    const allocs = [
      { batchId: 'e', batchNumber: 'e', expiryDate: null, unitCost: 1, qty: 8 },
      { batchId: 'l', batchNumber: 'l', expiryDate: null, unitCost: 1, qty: 4 },
    ];
    const rows = splitAllocations(allocs, 10, 2);
    expect(rows.map((r) => [r.batchId, r.quantity, r.bonusQuantity])).toEqual([['e', 8, 0], ['l', 2, 2]]);
  });
  it('totals always add up', () => {
    const allocs = [{ batchId: null, batchNumber: null, expiryDate: null, unitCost: 0, qty: 12 }];
    const r = splitAllocations(allocs, 10, 2)[0];
    expect(r.quantity + r.bonusQuantity).toBe(12);
  });
  it('rejects a mismatched split', () => {
    expect(() => splitAllocations([{ batchId: null, batchNumber: null, expiryDate: null, unitCost: 0, qty: 5 }], 3, 3)).toThrow();
  });
});

describe('distributeReturn', () => {
  it('fills rows in order within their capacity', () => {
    const r = distributeReturn([{ id: 'a', capacity: 3 }, { id: 'b', capacity: 5 }], 6);
    expect(r.map((x) => [x.row.id, x.qty])).toEqual([['a', 3], ['b', 3]]);
  });
  it('skips rows with no capacity', () => {
    const r = distributeReturn([{ id: 'a', capacity: 0 }, { id: 'b', capacity: 5 }], 2);
    expect(r.map((x) => x.row.id)).toEqual(['b']);
  });
  it('refuses more than the allocated capacity', () => {
    expect(() => distributeReturn([{ id: 'a', capacity: 2 }], 3)).toThrow();
  });
});

describe('weightedAverageCost', () => {
  it('blends old and new stock', () => {
    expect(weightedAverageCost(10, 1000, 10, 12_000)).toBe(1100);
  });
  it('first receipt sets the cost', () => {
    expect(weightedAverageCost(0, 0, 10, 8_000)).toBe(800);
  });
  it('free bonus units lower the average', () => {
    expect(weightedAverageCost(0, 0, 12, 10_000)).toBe(833); // 10,000 / 12 = 833.33
  });
  it('rounds half up', () => {
    expect(weightedAverageCost(0, 0, 2, 3)).toBe(2);
  });
  it('is 0 when nothing is on hand', () => {
    expect(weightedAverageCost(0, 0, 0, 0)).toBe(0);
  });
});

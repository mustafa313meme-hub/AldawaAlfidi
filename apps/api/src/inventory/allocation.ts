/** Pure helpers for batch allocation, kept free of the database so they can be unit-tested. */

export interface Alloc {
  batchId: string | null; // null = unbatched stock (opening/legacy)
  batchNumber: string | null;
  expiryDate: Date | null;
  unitCost: number;
  qty: number;
}

export interface BatchRow {
  id: string;
  batchNumber: string;
  expiryDate: Date | null;
  quantity: number;
  cost: number;
}

/** First-Expire-First-Out: earliest expiry first, batches without expiry last, then oldest first. */
export function fefoOrder<T extends { expiryDate: Date | null; createdAt?: Date }>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    if (a.expiryDate && b.expiryDate) {
      const d = a.expiryDate.getTime() - b.expiryDate.getTime();
      if (d !== 0) return d;
    } else if (a.expiryDate) return -1;
    else if (b.expiryDate) return 1;
    return (a.createdAt?.getTime() ?? 0) - (b.createdAt?.getTime() ?? 0);
  });
}

export const isExpired = (expiry: Date | null, today: Date): boolean => !!expiry && expiry.getTime() < today.getTime();

export interface FefoResult {
  allocs: Alloc[];
  sellable: number;
  expired: number;
  unbatched: number;
}

/**
 * Plan how to take `qty` units: sellable batches in FEFO order, then the unbatched remainder.
 * Expired batches are never used unless `allowExpired` (e.g. writing them off).
 * Returns shortfall info instead of throwing so the caller can build a precise error.
 */
export function planFefo(batches: BatchRow[], stockTotal: number, qty: number, today: Date, allowExpired = false): FefoResult & { ok: boolean } {
  const withStock = batches.filter((b) => b.quantity > 0);
  const inBatches = withStock.reduce((s, b) => s + b.quantity, 0);
  const unbatched = stockTotal - inBatches;
  if (unbatched < 0) throw new Error('stock inconsistent: batches exceed stock total');
  const usable = fefoOrder(withStock.map((b) => ({ ...b, createdAt: undefined as Date | undefined }))).filter((b) => allowExpired || !isExpired(b.expiryDate, today));
  const expired = withStock.filter((b) => isExpired(b.expiryDate, today)).reduce((s, b) => s + b.quantity, 0);
  const sellable = usable.reduce((s, b) => s + b.quantity, 0) + unbatched;
  if (qty > sellable) return { ok: false, allocs: [], sellable, expired, unbatched };

  let rem = qty;
  const allocs: Alloc[] = [];
  for (const b of usable) {
    if (rem === 0) break;
    const take = Math.min(rem, b.quantity);
    allocs.push({ batchId: b.id, batchNumber: b.batchNumber, expiryDate: b.expiryDate, unitCost: b.cost, qty: take });
    rem -= take;
  }
  if (rem > 0) allocs.push({ batchId: null, batchNumber: null, expiryDate: null, unitCost: 0, qty: rem });
  return { ok: true, allocs, sellable, expired, unbatched };
}

export interface SplitRow extends Alloc {
  quantity: number; // sold part
  bonusQuantity: number; // free-goods part
}

/** Divide physical allocations between sold units (earliest batches first) and bonus units. */
export function splitAllocations(allocs: Alloc[], sold: number, bonus: number): SplitRow[] {
  const total = allocs.reduce((s, a) => s + a.qty, 0);
  if (total !== sold + bonus) throw new Error('allocation does not match sold + bonus');
  let remSold = sold;
  const out: SplitRow[] = [];
  for (const a of allocs) {
    const s = Math.min(remSold, a.qty);
    remSold -= s;
    out.push({ ...a, quantity: s, bonusQuantity: a.qty - s });
  }
  return out;
}

/** Spread a returned quantity over allocation rows that still have capacity, in order. */
export function distributeReturn<T extends { id: string }>(rows: (T & { capacity: number })[], qty: number): { row: T; qty: number }[] {
  let rem = qty;
  const out: { row: T; qty: number }[] = [];
  for (const r of rows) {
    if (rem === 0) break;
    const take = Math.min(rem, r.capacity);
    if (take > 0) {
      out.push({ row: r, qty: take });
      rem -= take;
    }
  }
  if (rem > 0) throw new Error('return exceeds allocated quantity');
  return out;
}

/** Weighted average cost, round-half-up, exact for large numbers (BigInt). */
export function weightedAverageCost(oldQty: number, oldAvg: number, addQty: number, addTotalCost: number): number {
  const q = BigInt(oldQty) + BigInt(addQty);
  if (q <= 0n) return 0;
  const num = BigInt(oldQty) * BigInt(oldAvg) + BigInt(addTotalCost);
  return Number((num * 2n + q) / (2n * q));
}

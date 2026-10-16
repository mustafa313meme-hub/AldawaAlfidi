export interface BonusTier {
  min: number;
  bonus: number;
}

export const MAX_BONUS_QTY = 100_000;

/**
 * Bonus (free goods) for `sold` units given tier rules such as "every 10 + 2", "every 20 + 5".
 * Picks the combination that gives the customer the MOST bonus (unbounded knapsack), which also makes
 * the result monotonic: selling more never lowers the bonus (needed for the Proportional return policy).
 */
export function bonusFor(sold: number, tiers: BonusTier[]): number {
  if (!Number.isInteger(sold) || sold < 0 || sold > MAX_BONUS_QTY) throw new RangeError('quantity out of range');
  const valid = tiers.filter((t) => Number.isInteger(t.min) && Number.isInteger(t.bonus) && t.min >= 1 && t.bonus >= 1);
  if (!valid.length || sold === 0) return 0;
  const best = new Array<number>(sold + 1).fill(0);
  for (let q = 1; q <= sold; q++) {
    let b = best[q - 1];
    for (const t of valid) if (t.min <= q) b = Math.max(b, best[q - t.min] + t.bonus);
    best[q] = b;
  }
  return best[sold];
}

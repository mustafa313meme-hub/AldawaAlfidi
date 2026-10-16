// Mirrors apps/api/src/sales/bonus.ts and return-policy.ts so the return screen can show what the server will require.
// The SERVER decides; this is only a preview. Keep both in sync (the node test below runs the same cases as the server specs).

export function bonusFor(sold, tiers) {
  const valid = (tiers || []).filter((t) => Number.isInteger(t.min) && Number.isInteger(t.bonus) && t.min >= 1 && t.bonus >= 1);
  if (!valid.length || sold <= 0) return 0;
  const best = new Array(sold + 1).fill(0);
  for (let q = 1; q <= sold; q++) {
    let b = best[q - 1];
    for (const t of valid) if (t.min <= q) b = Math.max(b, best[q - t.min] + t.bonus);
    best[q] = b;
  }
  return best[sold];
}

/** item: {quantity, bonusQuantity, returnedQuantity, bonusReturnedQuantity, tiers}; returns what the policy requires for returning `soldQty`. */
export function requiredBonus(policy, item, soldQty) {
  const bonusHeld = item.bonusQuantity - item.bonusReturnedQuantity;
  if (soldQty <= 0) return 0;
  if (policy === 'Proportional') {
    const remainingSold = item.quantity - item.returnedQuantity - soldQty;
    return Math.max(0, bonusHeld - bonusFor(remainingSold, item.tiers));
  }
  if (policy === 'FullBonusOnReturn') return bonusHeld;
  return 0;
}

/** Value of returning `qty` more units of a line (BigInt, round-half-up, telescoping): mirrors apps/api/src/sales/money.ts creditForReturn. */
export function creditForReturn(lineTotal, quantity, alreadyReturned, qty) {
  const part = (k) => (BigInt(lineTotal) * BigInt(k) * 2n + BigInt(quantity)) / (2n * BigInt(quantity));
  return Number(part(alreadyReturned + qty) - part(alreadyReturned));
}

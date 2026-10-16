/**
 * Money is integer IQD. No floating point anywhere in amounts (SRS §48).
 * Rounding rule (single, system-wide): round half up to the nearest dinar.
 */
export class MoneyError extends Error {}

/** round-half-up(a * b / d) for non-negative integers, exact via BigInt (no 2^53 overflow). */
export function mulDivRound(a: number, b: number, d: number): number {
  if (![a, b, d].every(Number.isSafeInteger) || a < 0 || b < 0 || d <= 0) throw new MoneyError('invalid operands');
  const D = BigInt(d);
  return Number((BigInt(a) * BigInt(b) * 2n + D) / (2n * D));
}

export type DiscountType = 'Percent' | 'Amount';

export interface LineInput {
  quantity: number;
  unitPrice: number;
  discountType?: DiscountType | null;
  /** Percent: basis points (1000 = 10%). Amount: dinars. */
  discountValue?: number;
  taxRateBp?: number;
}

export interface LineTotals {
  gross: number;
  discountAmount: number;
  net: number;
  taxAmount: number;
  lineTotal: number;
}

export function computeLine(i: LineInput): LineTotals {
  if (!Number.isSafeInteger(i.quantity) || i.quantity < 1) throw new MoneyError('quantity must be a positive integer');
  if (!Number.isSafeInteger(i.unitPrice) || i.unitPrice < 0) throw new MoneyError('unitPrice must be a non-negative integer');
  const gross = i.quantity * i.unitPrice;
  if (!Number.isSafeInteger(gross)) throw new MoneyError('line amount too large');

  const dv = i.discountValue ?? 0;
  if (!Number.isSafeInteger(dv) || dv < 0) throw new MoneyError('invalid discount');
  let discountAmount = 0;
  if (i.discountType === 'Percent') {
    if (dv > 10_000) throw new MoneyError('discount over 100%');
    discountAmount = mulDivRound(gross, dv, 10_000);
  } else if (i.discountType === 'Amount') {
    if (dv > gross) throw new MoneyError('discount exceeds line amount');
    discountAmount = dv;
  } else if (dv !== 0) {
    throw new MoneyError('discount value without type');
  }

  const net = gross - discountAmount;
  const bp = i.taxRateBp ?? 0;
  if (!Number.isSafeInteger(bp) || bp < 0 || bp > 10_000) throw new MoneyError('invalid tax rate');
  const taxAmount = mulDivRound(net, bp, 10_000);
  return { gross, discountAmount, net, taxAmount, lineTotal: net + taxAmount };
}

/**
 * Value of returning `qty` more units of a line, given `alreadyReturned` units were credited before.
 * Telescoping rounding: the credits of all partial returns add up to exactly the line total
 * when everything is returned, with no lost or invented dinar.
 */
export function creditForReturn(lineTotal: number, quantity: number, alreadyReturned: number, qty: number): number {
  if (alreadyReturned + qty > quantity) throw new MoneyError('return exceeds sold quantity');
  return mulDivRound(lineTotal, alreadyReturned + qty, quantity) - mulDivRound(lineTotal, alreadyReturned, quantity);
}

import { bonusFor } from './bonus';
import { computeLine, creditForReturn, mulDivRound } from './money';
import { planReturnLine } from './return-policy';

describe('money', () => {
  it('SRS §58: 10 x 10,000 with 10% discount = 90,000 net', () => {
    const t = computeLine({ quantity: 10, unitPrice: 10_000, discountType: 'Percent', discountValue: 1000 });
    expect(t).toEqual({ gross: 100_000, discountAmount: 10_000, net: 90_000, taxAmount: 0, lineTotal: 90_000 });
  });
  it('amount discount and tax', () => {
    const t = computeLine({ quantity: 3, unitPrice: 1_000, discountType: 'Amount', discountValue: 500, taxRateBp: 500 });
    expect(t.net).toBe(2_500);
    expect(t.taxAmount).toBe(125);
    expect(t.lineTotal).toBe(2_625);
  });
  it('rounds half up and never uses floats', () => {
    expect(mulDivRound(1, 1, 2)).toBe(1);
    expect(mulDivRound(1, 1, 3)).toBe(0);
    expect(mulDivRound(5, 1, 10)).toBe(1);
    expect(mulDivRound(2_000_000_000, 9_999, 10_000)).toBe(1_999_800_000);
  });
  it('is exact where float math would drift', () => {
    expect(computeLine({ quantity: 1, unitPrice: 1_005, discountType: 'Percent', discountValue: 1000 }).discountAmount).toBe(101); // 100.5 -> 101
  });
  it('rejects invalid input', () => {
    expect(() => computeLine({ quantity: 0, unitPrice: 1 })).toThrow();
    expect(() => computeLine({ quantity: 1, unitPrice: 100, discountType: 'Amount', discountValue: 101 })).toThrow();
    expect(() => computeLine({ quantity: 1, unitPrice: 100, discountType: 'Percent', discountValue: 10_001 })).toThrow();
    expect(() => computeLine({ quantity: 1, unitPrice: 100, discountValue: 5 })).toThrow();
  });
  it('partial return credits add up to exactly the line total (telescoping)', () => {
    const total = 100_000 - 1; // awkward number
    const qty = 7;
    let returned = 0;
    let sum = 0;
    for (const q of [1, 2, 1, 3]) {
      sum += creditForReturn(total, qty, returned, q);
      returned += q;
    }
    expect(returned).toBe(7);
    expect(sum).toBe(total);
  });
  it('credit uses the discounted price: returning 2 of 10 (net 90,000) = 18,000', () => {
    expect(creditForReturn(90_000, 10, 0, 2)).toBe(18_000);
  });
  it('cannot credit more than was sold', () => {
    expect(() => creditForReturn(90_000, 10, 9, 2)).toThrow();
  });
});

describe('bonusFor', () => {
  it('every 10 + 2', () => {
    const t = [{ min: 10, bonus: 2 }];
    expect([0, 9, 10, 19, 20, 35].map((q) => bonusFor(q, t))).toEqual([0, 0, 2, 2, 4, 6]);
  });
  it('combines tiers for the customer (every 20+5, every 10+2)', () => {
    const t = [{ min: 20, bonus: 5 }, { min: 10, bonus: 2 }];
    expect(bonusFor(30, t)).toBe(7);
    expect(bonusFor(20, t)).toBe(5);
    expect(bonusFor(19, t)).toBe(2);
  });
  it('is monotonic even with odd rules', () => {
    const t = [{ min: 10, bonus: 2 }, { min: 20, bonus: 1 }];
    let prev = 0;
    for (let q = 0; q <= 200; q++) {
      const b = bonusFor(q, t);
      expect(b >= prev).toBe(true);
      prev = b;
    }
  });
  it('no rules, no bonus', () => {
    expect(bonusFor(100, [])).toBe(0);
  });
});

const tiers = [{ min: 10, bonus: 2 }];
const item = (over: Partial<{ quantity: number; bonusQuantity: number; returnedQuantity: number; bonusReturnedQuantity: number }> = {}) =>
  ({ quantity: 10, bonusQuantity: 2, returnedQuantity: 0, bonusReturnedQuantity: 0, tiers, ...over });

describe('planReturnLine — Proportional (approved policy)', () => {
  it('10+2, return 2 sold -> remaining 8 -> entitled 0 -> the 2 bonus must come back', () => {
    const p = planReturnLine('Proportional', item(), { soldQuantity: 2, bonusQuantity: 0 }, false);
    expect(p.requiredBonus).toBe(2);
    expect(p.bonusReturnQty).toBe(2);
    expect(p.bonusBilledQty).toBe(0);
  });
  it('20+4, return 3 sold -> remaining 17 -> entitled 2 -> 2 bonus must come back', () => {
    const p = planReturnLine('Proportional', item({ quantity: 20, bonusQuantity: 4 }), { soldQuantity: 3, bonusQuantity: 0 }, false);
    expect(p.requiredBonus).toBe(2);
  });
  it('20+4, return 10 sold -> remaining 10 -> entitled 2 -> 2 must come back', () => {
    expect(planReturnLine('Proportional', item({ quantity: 20, bonusQuantity: 4 }), { soldQuantity: 10, bonusQuantity: 0 }, false).requiredBonus).toBe(2);
  });
  it('30+6 (3 tiers), return 5 -> remaining 25 -> entitled 4 -> 2 back', () => {
    expect(planReturnLine('Proportional', item({ quantity: 30, bonusQuantity: 6 }), { soldQuantity: 5, bonusQuantity: 0 }, false).requiredBonus).toBe(2);
  });
  it('a return that keeps the tier requires no bonus back', () => {
    const p = planReturnLine('Proportional', item({ quantity: 25, bonusQuantity: 4 }), { soldQuantity: 3, bonusQuantity: 0 }, false);
    expect(p.requiredBonus).toBe(0);
  });
  it('requirement counts only the bonus the customer still holds', () => {
    const p = planReturnLine('Proportional', item({ bonusReturnedQuantity: 2 }), { soldQuantity: 2, bonusQuantity: 0 }, false);
    expect(p.requiredBonus).toBe(0);
  });
  it('independent bonus-only return: no sold change, no requirement', () => {
    const p = planReturnLine('Proportional', item(), { soldQuantity: 0, bonusQuantity: 1 }, false);
    expect(p).toMatchObject({ soldQty: 0, requiredBonus: 0, bonusReturnQty: 1, bonusBilledQty: 0 });
  });
  it('voluntary bonus larger than the requirement is honoured', () => {
    const p = planReturnLine('Proportional', item({ quantity: 20, bonusQuantity: 4 }), { soldQuantity: 3, bonusQuantity: 3 }, false);
    expect(p.bonusReturnQty).toBe(3);
  });
  it('billExcess: required bonus is billed instead of returned', () => {
    const p = planReturnLine('Proportional', item(), { soldQuantity: 2, bonusQuantity: 0 }, true);
    expect(p).toMatchObject({ bonusReturnQty: 0, bonusBilledQty: 2 });
  });
  it('billExcess with partial voluntary return bills only the rest', () => {
    const p = planReturnLine('Proportional', item({ quantity: 20, bonusQuantity: 4 }), { soldQuantity: 20, bonusQuantity: 1 }, true);
    expect(p).toMatchObject({ bonusReturnQty: 1, bonusBilledQty: 3 });
  });
});

describe('planReturnLine — limits and other policies', () => {
  it('never allows more sold than returnable', () => {
    expect(() => planReturnLine('Proportional', item({ returnedQuantity: 9 }), { soldQuantity: 2, bonusQuantity: 0 }, false)).toThrow();
  });
  it('never allows more bonus than the customer holds', () => {
    expect(() => planReturnLine('Proportional', item(), { soldQuantity: 0, bonusQuantity: 3 }, false)).toThrow();
    expect(() => planReturnLine('Independent', item({ bonusReturnedQuantity: 1 }), { soldQuantity: 0, bonusQuantity: 2 }, false)).toThrow();
  });
  it('Independent: bonus is untouched by a sold return (SRS §28 example)', () => {
    const p = planReturnLine('Independent', item(), { soldQuantity: 2, bonusQuantity: 0 }, false);
    expect(p).toMatchObject({ requiredBonus: 0, bonusReturnQty: 0 });
  });
  it('FullBonusOnReturn: any sold return pulls back all remaining bonus', () => {
    const p = planReturnLine('FullBonusOnReturn', item(), { soldQuantity: 1, bonusQuantity: 0 }, false);
    expect(p.bonusReturnQty).toBe(2);
  });
  it('rejects negative or fractional quantities', () => {
    expect(() => planReturnLine('Proportional', item(), { soldQuantity: -1, bonusQuantity: 0 }, false)).toThrow();
    expect(() => planReturnLine('Proportional', item(), { soldQuantity: 1.5, bonusQuantity: 0 }, false)).toThrow();
  });
  it('full return of everything returns all bonus too', () => {
    const p = planReturnLine('Proportional', item(), { soldQuantity: 10, bonusQuantity: 0 }, false);
    expect(p).toMatchObject({ bonusReturnQty: 2 });
  });
});

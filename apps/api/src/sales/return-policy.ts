import { BonusTier, bonusFor } from './bonus';

export type BonusReturnPolicy = 'Independent' | 'Proportional' | 'FullBonusOnReturn';

export class ReturnPolicyError extends Error {
  constructor(public code: string, message: string) {
    super(message);
  }
}

export interface ItemState {
  quantity: number;
  bonusQuantity: number;
  returnedQuantity: number;
  bonusReturnedQuantity: number;
  /** Rules as they were on the invoice date (snapshot), not today's rules. */
  tiers: BonusTier[];
}

export interface ReturnRequest {
  soldQuantity: number;
  /** Bonus the customer volunteers to give back (independent bonus return). */
  bonusQuantity: number;
}

export interface ReturnPlan {
  soldQty: number;
  /** Bonus units physically coming back (voluntary + policy-required). */
  bonusReturnQty: number;
  /** Policy-required bonus that is billed instead of returned (requires approval upstream). */
  bonusBilledQty: number;
  /** Bonus the policy requires back after this sold return. */
  requiredBonus: number;
  soldReturnableBefore: number;
  bonusReturnableBefore: number;
}

export function planReturnLine(policy: BonusReturnPolicy, item: ItemState, req: ReturnRequest, billExcess: boolean): ReturnPlan {
  const { soldQuantity: soldQty, bonusQuantity: voluntary } = req;
  if (!Number.isInteger(soldQty) || !Number.isInteger(voluntary) || soldQty < 0 || voluntary < 0) {
    throw new ReturnPolicyError('INVALID_QUANTITY', 'الكمية يجب أن تكون عدداً صحيحاً غير سالب');
  }
  const soldReturnable = item.quantity - item.returnedQuantity;
  const bonusHeld = item.bonusQuantity - item.bonusReturnedQuantity; // bonus the customer still holds
  if (soldQty > soldReturnable) throw new ReturnPolicyError('SOLD_EXCEEDS_RETURNABLE', `الكمية المباعة المرتجعة تتجاوز القابل للإرجاع (${soldReturnable})`);
  if (voluntary > bonusHeld) throw new ReturnPolicyError('BONUS_EXCEEDS_RETURNABLE', `البونص المرتجع يتجاوز القابل للإرجاع (${bonusHeld})`);

  let required = 0;
  if (soldQty > 0) {
    if (policy === 'Proportional') {
      const remainingSold = item.quantity - item.returnedQuantity - soldQty;
      required = Math.max(0, bonusHeld - bonusFor(remainingSold, item.tiers));
    } else if (policy === 'FullBonusOnReturn') {
      required = bonusHeld;
    }
  }

  const bonusReturnQty = billExcess ? voluntary : Math.max(voluntary, required);
  const bonusBilledQty = billExcess ? Math.max(0, required - voluntary) : 0;
  return { soldQty, bonusReturnQty, bonusBilledQty, requiredBonus: required, soldReturnableBefore: soldReturnable, bonusReturnableBefore: bonusHeld };
}

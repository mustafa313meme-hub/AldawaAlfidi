// Same cases as the server specs (apps/api/src/sales/sales-logic.spec.ts): the client preview must agree with the server.
import assert from 'node:assert/strict';
import { bonusFor, creditForReturn, requiredBonus } from '../js/logic.js';

const t10 = [{ min: 10, bonus: 2 }];
assert.deepEqual([0, 9, 10, 19, 20, 35].map((q) => bonusFor(q, t10)), [0, 0, 2, 2, 4, 6]);
assert.equal(bonusFor(30, [{ min: 20, bonus: 5 }, { min: 10, bonus: 2 }]), 7);
assert.equal(bonusFor(19, [{ min: 20, bonus: 5 }, { min: 10, bonus: 2 }]), 2);
assert.equal(bonusFor(100, []), 0);

const item = (o = {}) => ({ quantity: 10, bonusQuantity: 2, returnedQuantity: 0, bonusReturnedQuantity: 0, tiers: t10, ...o });
assert.equal(requiredBonus('Proportional', item(), 2), 2);                                   // 10+2, return 2 -> 8 left -> 0 entitled
assert.equal(requiredBonus('Proportional', item({ quantity: 20, bonusQuantity: 4 }), 3), 2);  // 17 left -> 2 entitled
assert.equal(requiredBonus('Proportional', item({ quantity: 20, bonusQuantity: 4 }), 10), 2);
assert.equal(requiredBonus('Proportional', item({ quantity: 30, bonusQuantity: 6 }), 5), 2);
assert.equal(requiredBonus('Proportional', item({ quantity: 25, bonusQuantity: 4 }), 3), 0);  // tier kept
assert.equal(requiredBonus('Proportional', item({ bonusReturnedQuantity: 2 }), 2), 0);        // nothing held any more
assert.equal(requiredBonus('Proportional', item(), 0), 0);
assert.equal(requiredBonus('Independent', item(), 2), 0);
assert.equal(requiredBonus('FullBonusOnReturn', item(), 1), 2);
assert.equal(requiredBonus('Proportional', item(), 10), 2);                                    // full return: all bonus back
// credit: same cases as the server (money.ts)
assert.equal(creditForReturn(90000, 10, 0, 2), 18000);
{ let r = 0, sum = 0; for (const q of [1, 2, 1, 3]) { sum += creditForReturn(99999, 7, r, q); r += q; } assert.equal(sum, 99999); }
console.log('client logic: 16 assertions passed (match the server specs)');

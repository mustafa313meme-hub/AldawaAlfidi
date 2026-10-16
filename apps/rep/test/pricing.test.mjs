import assert from 'node:assert/strict';
import fs from 'node:fs';
import { priceBook, previewLine } from '../js/pricing.js';
// the rep copy of the return/bonus logic must stay identical to the admin copy (both mirror the server)
assert.equal(fs.readFileSync(new URL('../js/logic.js', import.meta.url), 'utf8'), fs.readFileSync(new URL('../../admin/js/logic.js', import.meta.url), 'utf8'), 'logic.js drifted from admin');
const lists = [{ id: 'def', isDefault: true, isActive: true }, { id: 'pl1', isDefault: false, isActive: true }];
const items = [{ priceListId: 'pl1', productId: 'p1', price: 10000 }, { priceListId: 'def', productId: 'p1', price: 11000 }, { priceListId: 'def', productId: 'p2', price: 4000 }];
const rules = [{ productId: 'p1', minQuantity: 10, bonusQuantity: 2, isActive: true, startDate: '2026-01-01', endDate: '2026-12-31', customerType: 'Pharmacy' }, { productId: 'p1', minQuantity: 5, bonusQuantity: 5, isActive: false }, { productId: 'p1', minQuantity: 1, bonusQuantity: 1, isActive: true, endDate: '2026-01-02' }];
const book = priceBook({ priceLists: lists, priceListItems: items, bonusRules: rules }, '2026-10-15');
const p1 = { id: 'p1', salePrice: 12000, bonusEligible: true }, p2 = { id: 'p2', salePrice: 5000, bonusEligible: true }, p3 = { id: 'p3', salePrice: 7000, bonusEligible: true }, np = { id: 'p1', bonusEligible: false, salePrice: 1 };
assert.deepEqual(book.priceOf(p1, { priceListId: 'pl1' }), { price: 10000, source: 'price_list' });   // customer's list
assert.deepEqual(book.priceOf(p1, { priceListId: null }), { price: 11000, source: 'default_list' }); // default list
assert.deepEqual(book.priceOf(p2, { priceListId: 'pl1' }), { price: 4000, source: 'default_list' });  // not in own list -> default
assert.deepEqual(book.priceOf(p3, {}), { price: 7000, source: 'product' });
assert.equal(book.priceOf({ id: 'p3' }, {}).price, null);                                            // no view_prices
assert.equal(previewLine(book, p1, { customerType: 'Pharmacy', priceListId: 'pl1' }, 25).bonus, 4);    // 2 tiers of 10 -> 4 (expired + inactive rules ignored)
assert.equal(previewLine(book, p1, { customerType: 'Doctor' }, 25).bonus, 0);                          // rule is Pharmacy-only
assert.equal(previewLine(book, np, { customerType: 'Pharmacy' }, 25).bonus, 0);                        // bonus not allowed on product
assert.equal(previewLine(book, p1, { customerType: 'Pharmacy', priceListId: 'pl1' }, 3).gross, 30000);
console.log('rep pricing: 11 assertions passed');

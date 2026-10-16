// Price + bonus preview for the order screen. The SERVER recalculates everything when it receives the order; this is only what
// the rep sees offline. Same rules as apps/api/src/sales/sales-calc.service.ts (price list -> default list -> product price; tier bonus).
import { bonusFor } from './logic.js';
export { bonusFor, creditForReturn, requiredBonus } from './logic.js';

/** Build lookups once per screen from the local database rows. */
export function priceBook({ priceLists, priceListItems, bonusRules }, today) {
  const defaultList = priceLists.find((l) => l.isDefault && l.isActive);
  const items = new Map(priceListItems.map((i) => [`${i.priceListId}:${i.productId}`, i.price]));
  const rulesBy = new Map();
  for (const r of bonusRules) {
    if (!r.isActive) continue;
    if (!rulesBy.has(r.productId)) rulesBy.set(r.productId, []);
    rulesBy.get(r.productId).push(r);
  }
  const day = (v) => (v ? String(v).slice(0, 10) : null);
  const tiersFor = (product, customer) => {
    if (!product.bonusEligible) return [];
    return (rulesBy.get(product.id) || [])
      .filter((r) => (!r.startDate || day(r.startDate) <= today) && (!r.endDate || day(r.endDate) >= today) && (!r.customerType || r.customerType === customer.customerType))
      .map((r) => ({ min: r.minQuantity, bonus: r.bonusQuantity }));
  };
  const priceOf = (product, customer) => {
    const own = customer.priceListId ? items.get(`${customer.priceListId}:${product.id}`) : undefined;
    if (own !== undefined) return { price: own, source: 'price_list' };
    const def = defaultList ? items.get(`${defaultList.id}:${product.id}`) : undefined;
    if (def !== undefined) return { price: def, source: 'default_list' };
    return product.salePrice === undefined ? { price: null, source: 'hidden' } : { price: product.salePrice, source: 'product' };
  };
  return { priceOf, tiersFor };
}

/** One order line: unit price, bonus units and the gross value (no tax/discount: the server adds those). */
export function previewLine(book, product, customer, qty) {
  const { price, source } = book.priceOf(product, customer);
  const tiers = book.tiersFor(product, customer);
  const bonus = Number.isInteger(qty) && qty > 0 && qty <= 100000 ? bonusFor(qty, tiers) : 0;
  return { price, source, bonus, gross: price === null ? null : price * qty, tiers };
}

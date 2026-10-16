export type PriceSource = 'price_list' | 'default_list' | 'product';

/** Resolution order: customer's list → default list → product.salePrice. Pure, so it is unit-tested. */
export function resolvePrice(input: { listPrice?: number | null; defaultListPrice?: number | null; productSalePrice: number }): { price: number; source: PriceSource } {
  if (input.listPrice != null) return { price: input.listPrice, source: 'price_list' };
  if (input.defaultListPrice != null) return { price: input.defaultListPrice, source: 'default_list' };
  return { price: input.productSalePrice, source: 'product' };
}

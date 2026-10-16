import { resolvePrice } from './pricing';

describe('resolvePrice', () => {
  it('prefers the customer list', () => {
    expect(resolvePrice({ listPrice: 900, defaultListPrice: 950, productSalePrice: 1000 })).toEqual({ price: 900, source: 'price_list' });
  });
  it('falls back to the default list, then the product price', () => {
    expect(resolvePrice({ listPrice: null, defaultListPrice: 950, productSalePrice: 1000 })).toEqual({ price: 950, source: 'default_list' });
    expect(resolvePrice({ productSalePrice: 1000 })).toEqual({ price: 1000, source: 'product' });
  });
  it('treats 0 as a real price, not as missing', () => {
    expect(resolvePrice({ listPrice: 0, productSalePrice: 1000 }).price).toBe(0);
  });
});

import { lookup } from '../api.js';
import { fmtNum } from '../dom.js';
import { resourceList } from '../resource.js';

export const title = 'أرصدة المخزون';

export default async function render(ctx) {
  const wh = await lookup('/warehouses', 'name').catch(() => []);
  await resourceList({
    title: 'أرصدة المخزون', endpoint: '/stock', search: true, filters: [{ name: 'warehouseId', label: 'المخزن', options: wh }],
    columns: [
      { key: 'product', label: 'الرمز', fmt: (v) => (v ? v.sku : '') }, { key: 'product', label: 'المنتج', fmt: (v) => (v ? v.nameAr : '') }, { key: 'warehouse', label: 'المخزن', fmt: (v) => (v ? v.name : '') },
      { key: 'quantity', label: 'الكمية', num: true, fmt: fmtNum },
      ...(ctx.can('products.view_cost') ? [{ key: 'averageCost', label: 'متوسط التكلفة', num: true, fmt: fmtNum }] : []),
    ],
  })(ctx);
}

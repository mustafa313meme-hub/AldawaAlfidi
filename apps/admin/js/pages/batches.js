import { lookup } from '../api.js';
import { badge, fmtDate, fmtNum, h } from '../dom.js';
import { resourceList } from '../resource.js';

export const title = 'التشغيلات والصلاحية';

const TABS = [['all', 'كل التشغيلات', '/inventory/batches'], ['near', 'تنتهي خلال 90 يوماً', '/inventory/batches/near-expiry'], ['expired', 'منتهية الصلاحية', '/inventory/batches/expired']];

export default async function render(ctx) {
  const tab = TABS.find((t) => t[0] === ctx.query.tab) || TABS[0];
  const wh = await lookup('/warehouses', 'name').catch(() => []);
  ctx.root.append(h('div', { class: 'tabs' }, TABS.map((t) => h('button', { type: 'button', class: t[0] === tab[0] ? 'on' : '', onclick: () => ctx.navigate('/batches?tab=' + t[0]) }, t[1]))));
  await resourceList({
    title: tab[1], endpoint: tab[2], filters: [{ name: 'warehouseId', label: 'المخزن', options: wh }],
    columns: [
      { key: 'product', label: 'المنتج', fmt: (v) => (v ? v.nameAr : '') }, { key: 'warehouse', label: 'المخزن', fmt: (v) => (v ? v.name : '') }, { key: 'batchNumber', label: 'التشغيلة' },
      { key: 'expiryDate', label: 'الانتهاء', fmt: fmtDate }, { key: 'daysToExpiry', label: 'متبقٍ (يوم)', num: true },
      { key: 'quantity', label: 'الكمية', num: true, fmt: fmtNum }, { key: 'expired', label: '', render: (r) => (r.expired ? badge('منتهية', 'bad') : r.daysToExpiry !== null && r.daysToExpiry <= 90 ? badge('قريبة', 'warn') : '') },
      ...(ctx.can('products.view_cost') ? [{ key: 'cost', label: 'التكلفة', num: true, fmt: fmtNum }] : []),
    ],
  })(ctx);
}

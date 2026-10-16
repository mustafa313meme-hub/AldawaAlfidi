import { api, lookup } from '../api.js';
import { badge, fmtNum } from '../dom.js';
import { formModal, resourceList } from '../resource.js';

export const title = 'المنتجات';

const fields = (can, edit) => [
  { name: 'nameAr', label: 'الاسم بالعربية', required: true },
  { name: 'nameEn', label: 'الاسم بالإنجليزية' },
  { name: 'genericName', label: 'الاسم العلمي' },
  { name: 'companyId', label: 'الشركة', type: 'select', required: true, load: () => lookup('/companies', 'name') },
  { name: 'categoryId', label: 'التصنيف', type: 'select', load: () => lookup('/categories', 'name') },
  { name: 'barcode', label: 'الباركود' },
  { name: 'unit', label: 'الوحدة' },
  { name: 'packSize', label: 'حجم العبوة', type: 'number', min: 1 },
  { name: 'salePrice', label: 'سعر البيع', type: 'number', min: 0, required: !edit },
  ...(can('products.view_cost') ? [{ name: 'purchasePrice', label: 'سعر الشراء', type: 'number', min: 0 }, { name: 'minSalePrice', label: 'الحد الأدنى للبيع', type: 'number', min: 0 }] : []),
  { name: 'taxRate', label: 'الضريبة %', type: 'number', min: 0, max: 100 },
  { name: 'reorderLevel', label: 'حد إعادة الطلب', type: 'number', min: 0 },
  { name: 'bonusEligible', label: 'يقبل البونص', type: 'checkbox', default: true },
  { name: 'discountEligible', label: 'يقبل الخصم', type: 'checkbox', default: true },
  ...(edit ? [{ name: 'isActive', label: 'فعّال', type: 'checkbox' }] : []),
  { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true },
];

export default async function render(ctx) {
  const showPrice = ctx.can('products.view_prices');
  await resourceList({
    title: 'المنتجات', endpoint: '/products', search: true,
    columns: [
      { key: 'sku', label: 'الرمز' }, { key: 'nameAr', label: 'المنتج' }, { key: 'company', label: 'الشركة', fmt: (v) => (v ? v.name : '') }, { key: 'category', label: 'التصنيف', fmt: (v) => (v ? v.name : '') },
      ...(showPrice ? [{ key: 'salePrice', label: 'سعر البيع', num: true, fmt: fmtNum }] : []),
      { key: 'barcode', label: 'الباركود' }, { key: 'isActive', label: 'الحالة', render: (r) => badge(r.isActive ? 'فعّال' : 'معطّل', r.isActive ? 'ok' : 'bad') },
    ],
    onRow: ctx.can('products.update') ? (r, reload) => formModal({ title: 'تعديل المنتج', fields: fields(ctx.can, true), initial: { ...r, companyId: r.company && r.company.id, categoryId: r.category && r.category.id }, wide: true, submit: (v) => api('PATCH', `/products/${r.id}`, { body: v }), onDone: reload }) : undefined,
    create: { label: 'منتج جديد', perm: 'products.create', open: (reload) => formModal({ title: 'منتج جديد', fields: fields(ctx.can, false), wide: true, submit: (v) => api('POST', '/products', { body: v }), onDone: reload }) },
  })(ctx);
}

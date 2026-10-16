// Master data screens (companies, categories, warehouses, areas, representatives, price lists, bonus rules): list + create + edit.
import { api, lookup } from '../api.js';
import { UserError, badge, buildForm, errorBox, fmtDate, fmtNum, h, modal, table, toast } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { picker } from '../picker.js';
import { formModal, resourceList } from '../resource.js';

const active = (r) => badge(r.isActive ? 'فعّال' : 'معطّل', r.isActive ? 'ok' : 'bad');
const activeField = { name: 'isActive', label: 'فعّال', type: 'checkbox' };

function crud({ title, endpoint, columns, fields, editFields, perm, search = false, extraRow }) {
  return async function render(ctx) {
    await resourceList({
      title, endpoint, search, columns,
      onRow: ctx.can(perm + '.update') ? (r, reload) => (extraRow ? extraRow(r, reload, ctx) : edit(r, reload)) : undefined,
      create: { label: 'إضافة', perm: perm + '.create', open: (reload) => formModal({ title: 'إضافة', fields, wide: true, submit: (v) => api('POST', endpoint, { body: v }), onDone: reload }) },
    })(ctx);
    function edit(r, reload) {
      return formModal({ title: 'تعديل', fields: editFields || [...fields, activeField], initial: r, wide: true, submit: (v) => api('PATCH', `${endpoint}/${r.id}`, { body: v }), onDone: reload });
    }
  };
}

export const companies = crud({
  title: 'الشركات', endpoint: '/companies', perm: 'companies', search: true,
  columns: [{ key: 'name', label: 'الشركة' }, { key: 'phone', label: 'الهاتف' }, { key: 'contactPerson', label: 'المسؤول' }, { key: 'paymentTerms', label: 'شروط الدفع' }, { label: 'الحالة', render: active }],
  fields: [{ name: 'name', label: 'اسم الشركة', required: true }, { name: 'phone', label: 'الهاتف' }, { name: 'email', label: 'البريد' }, { name: 'contactPerson', label: 'المسؤول' }, { name: 'paymentTerms', label: 'شروط الدفع' }, { name: 'address', label: 'العنوان', full: true }, { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true }],
});

export const categories = crud({
  title: 'التصنيفات', endpoint: '/categories', perm: 'categories',
  columns: [{ key: 'name', label: 'التصنيف' }, { key: 'parentId', label: 'الأب', fmt: (v) => (v ? 'فرعي' : 'رئيسي') }, { label: 'الحالة', render: active }],
  fields: [{ name: 'name', label: 'اسم التصنيف', required: true }, { name: 'parentId', label: 'التصنيف الأب', type: 'select', load: () => lookup('/categories', 'name') }],
});

export const warehouses = crud({
  title: 'المخازن', endpoint: '/warehouses', perm: 'warehouses',
  columns: [{ key: 'code', label: 'الكود' }, { key: 'name', label: 'المخزن' }, { key: 'location', label: 'الموقع' }, { key: 'manager', label: 'المسؤول', fmt: (v) => (v ? v.fullName : '') }, { label: 'الحالة', render: active }],
  fields: [{ name: 'name', label: 'اسم المخزن', required: true }, { name: 'location', label: 'الموقع' }, { name: 'managerId', label: 'مدير المخزن', type: 'select', load: () => lookup('/users', 'fullName') }],
});

export const areas = crud({
  title: 'المناطق', endpoint: '/areas', perm: 'areas',
  columns: [{ key: 'city', label: 'المدينة' }, { key: 'name', label: 'المنطقة' }, { key: 'district', label: 'الحي' }, { key: 'responsible', label: 'المندوب المسؤول', fmt: (v) => (v ? v.fullName : '—') }, { label: 'الحالة', render: active }],
  fields: [{ name: 'name', label: 'اسم المنطقة', required: true }, { name: 'city', label: 'المدينة', required: true }, { name: 'district', label: 'الحي' }, { name: 'description', label: 'وصف', full: true }],
  extraRow: (r, reload, ctx) => {
    const m = modal({ title: `${r.city} — ${r.name}`, body: h('p', { class: 'note' }, r.responsible ? `المندوب الحالي: ${r.responsible.fullName}` : 'المنطقة غير مسندة'), actions: [
      ctx.can('areas.assign') ? { label: r.responsible ? 'نقل المنطقة لمندوب آخر' : 'إسناد لمندوب', onClick: (close) => {
        close();
        formModal({ title: r.responsible ? 'نقل المنطقة' : 'إسناد المنطقة', fields: [
          { name: 'representativeId', label: 'المندوب', type: 'select', required: true, load: () => lookup('/representatives', (x) => `${x.employeeCode} — ${x.fullName}`) },
          ...(r.responsible ? [{ name: 'moveCustomers', label: 'انقل عملاء المنطقة المسندين للمندوب السابق معها', type: 'checkbox', default: true }] : [])],
        submit: (v) => (r.responsible ? api('POST', `/areas/${r.id}/transfer`, { body: { toRepresentativeId: v.representativeId, moveCustomers: v.moveCustomers } }) : api('POST', `/areas/${r.id}/assign`, { body: { representativeId: v.representativeId } })), onDone: reload });
      } } : null,
      { label: 'تعديل', kind: 'sec', onClick: (close) => { close(); formModal({ title: 'تعديل المنطقة', fields: [{ name: 'name', label: 'اسم المنطقة', required: true }, { name: 'city', label: 'المدينة', required: true }, { name: 'district', label: 'الحي' }, { name: 'description', label: 'وصف', full: true }, activeField], initial: r, wide: true, submit: (v) => api('PATCH', `/areas/${r.id}`, { body: v }), onDone: reload }); } },
      { label: 'إغلاق', kind: 'sec', onClick: (c) => c() }].filter(Boolean) });
    return m;
  },
});

export const representatives = crud({
  title: 'المندوبون', endpoint: '/representatives', perm: 'representatives', search: true,
  columns: [{ key: 'employeeCode', label: 'الكود' }, { key: 'fullName', label: 'المندوب' }, { key: 'phone', label: 'الهاتف' }, { key: 'user', label: 'حساب الدخول', fmt: (v) => (v ? v.username : '— لا يوجد —') },
    { key: 'status', label: 'الحالة', render: (r) => badge(lbl(L.repStatus, r.status), kind(L.repStatus, r.status)) }],
  fields: [{ name: 'fullName', label: 'الاسم الكامل', required: true }, { name: 'phone', label: 'الهاتف' }, { name: 'userId', label: 'حساب الدخول', type: 'select', load: () => lookup('/users', (u) => `${u.fullName} (${u.username})`) },
    { name: 'supervisorId', label: 'المشرف', type: 'select', load: () => lookup('/users', 'fullName') }, { name: 'hireDate', label: 'تاريخ التعيين', type: 'date' }, { name: 'nationalId', label: 'الهوية' }, { name: 'address', label: 'العنوان', full: true }, { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true }],
  editFields: [{ name: 'fullName', label: 'الاسم الكامل', required: true }, { name: 'phone', label: 'الهاتف' }, { name: 'status', label: 'الحالة', type: 'select', options: Object.entries(L.repStatus).map(([value, label]) => ({ value, label })) }, { name: 'notes', label: 'ملاحظات', type: 'textarea', full: true }],
});

export async function priceLists(ctx) {
  await resourceList({
    title: 'قوائم الأسعار', endpoint: '/price-lists',
    columns: [{ key: 'name', label: 'القائمة' }, { key: 'description', label: 'الوصف' }, { key: 'isDefault', label: 'افتراضية', fmt: (v) => (v ? 'نعم' : '') }, { key: '_count', label: 'عدد الأصناف', num: true, fmt: (v) => (v ? v.items : 0) }, { label: 'الحالة', render: active }],
    create: { label: 'قائمة جديدة', perm: 'price_lists.create', open: (reload) => formModal({ title: 'قائمة أسعار', fields: [{ name: 'name', label: 'الاسم', required: true }, { name: 'description', label: 'الوصف' }, { name: 'isDefault', label: 'قائمة افتراضية', type: 'checkbox' }], submit: (v) => api('POST', '/price-lists', { body: v }), onDone: reload }) },
    onRow: (r) => openItems(r, ctx),
  })(ctx);
}

async function openItems(list, ctx) {
  const holder = h('div');
  const err = h('div');
  const load = async () => {
    try {
      const { data } = await api('GET', `/price-lists/${list.id}/items`, { query: { pageSize: 100 } });
      holder.replaceChildren(table([{ label: 'المنتج', render: (r) => `${r.product.sku} — ${r.product.nameAr}` }, { key: 'price', label: 'السعر', num: true, fmt: fmtNum },
        { label: 'الحد الأدنى للمنتج', num: true, render: (r) => (r.product.minSalePrice !== undefined ? fmtNum(r.product.minSalePrice) : '') },
        { label: '', render: (r) => (ctx.can('price_lists.update') ? h('button', { class: 'btn sec sm', type: 'button', onclick: async () => { try { await api('DELETE', `/price-lists/${list.id}/items/${r.product.id}`); load(); } catch (e) { toast(e.message, 'bad'); } } }, 'حذف') : '') }], data, { empty: 'لا أسعار في هذه القائمة' }));
    } catch (e) { holder.replaceChildren(errorBox(e)); }
  };
  const pk = picker({ endpoint: '/products', label: (p) => `${p.sku} — ${p.nameAr}`, placeholder: 'ابحث عن منتج لإضافة سعره' });
  const price = h('input', { type: 'number', min: 0, 'aria-label': 'السعر' });
  const add = h('button', { class: 'btn', type: 'button', onclick: async () => {
    err.replaceChildren();
    if (!pk.value || price.value === '') { err.replaceChildren(errorBox({ message: 'اختر المنتج وأدخل السعر' })); return; }
    try { await api('PUT', `/price-lists/${list.id}/items`, { body: { items: [{ productId: pk.value.id, price: Number(price.value) }] } }); price.value = ''; toast('تم', 'ok'); load(); } catch (e) { err.replaceChildren(errorBox(e)); }
  } }, 'حفظ السعر');
  modal({ title: `أسعار «${list.name}»`, wide: true, body: h('div', {}, err, ctx.can('price_lists.update') ? h('div', { class: 'toolbar' }, h('label', { class: 'f' }, 'المنتج', pk.el), h('label', { class: 'f' }, 'السعر', price), add) : null, h('p', { class: 'note' }, 'السعر لا يقل عن الحد الأدنى للمنتج.'), holder), actions: [{ label: 'إغلاق', kind: 'sec', onClick: (c) => c() }] });
  await load();
}

export async function bonusRules(ctx) {
  const ruleFields = [{ name: 'minQuantity', label: 'كل (كمية)', type: 'number', min: 1, required: true }, { name: 'bonusQuantity', label: 'بونص (كمية)', type: 'number', min: 1, required: true },
    { name: 'startDate', label: 'من تاريخ', type: 'date' }, { name: 'endDate', label: 'إلى تاريخ', type: 'date' }, { name: 'customerType', label: 'نوع العميل (اختياري)', type: 'select', options: Object.entries(L.customerType).map(([value, label]) => ({ value, label })) }];
  await resourceList({
    title: 'قواعد البونص', endpoint: '/bonus-rules', query: { productId: ctx.query.productId },
    columns: [{ key: 'product', label: 'المنتج', fmt: (v) => (v ? `${v.sku} — ${v.nameAr}` : '') }, { label: 'القاعدة', render: (r) => `كل ${r.minQuantity} + ${r.bonusQuantity}` }, { key: 'startDate', label: 'من', fmt: fmtDate }, { key: 'endDate', label: 'إلى', fmt: fmtDate },
      { key: 'customerType', label: 'النوع', fmt: (v) => lbl(L.customerType, v) || 'الكل' }, { label: 'الحالة', render: active }],
    onRow: ctx.can('bonus_rules.manage') ? (r, reload) => formModal({ title: 'تعديل القاعدة', fields: [...ruleFields, activeField], initial: { ...r, startDate: r.startDate && r.startDate.slice(0, 10), endDate: r.endDate && r.endDate.slice(0, 10) }, wide: true, submit: (v) => api('PATCH', `/bonus-rules/${r.id}`, { body: v }), onDone: reload }) : undefined,
    create: { label: 'قاعدة جديدة', perm: 'bonus_rules.manage', open: (reload) => {
      const pk = picker({ endpoint: '/products', label: (p) => `${p.sku} — ${p.nameAr}`, placeholder: 'ابحث عن المنتج' });
      const m = formModal({ title: 'قاعدة بونص', fields: ruleFields, wide: true, extra: h('label', { class: 'f' }, 'المنتج', pk.el),
        submit: (v) => { if (!pk.value) throw new UserError('اختر المنتج'); return api('POST', '/bonus-rules', { body: { ...v, productId: pk.value.id } }); }, onDone: reload });
      return m;
    } },
  })(ctx);
}
void buildForm;

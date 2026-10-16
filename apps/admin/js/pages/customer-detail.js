import { api, lookup } from '../api.js';
import { badge, errorBox, fmtDate, fmtDateTime, fmtNum, h, kv, put, spinner, table, toast } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { formModal } from '../resource.js';
import { customerFields } from './customers.js';

export const title = 'العميل';

export default async function render(ctx) {
  const { id } = ctx.params;
  const holder = h('div', {}, spinner());
  ctx.root.append(holder);
  async function load() {
    holder.replaceChildren(spinner());
    try {
      const [c, bal, open, st] = await Promise.all([
        api('GET', `/customers/${id}`), ctx.can('ledger.view') ? api('GET', `/customers/${id}/balance`) : null,
        ctx.can('ledger.view') ? api('GET', `/customers/${id}/open-invoices`) : null, ctx.can('ledger.view') ? api('GET', `/customers/${id}/statement`) : null,
      ]);
      const cu = c.data;
      const tools = h('div', { class: 'toolbar' }, h('h2', {}, `${cu.code} — ${cu.name}`), h('div', { class: 'sp' }),
        ctx.can('customers.update') ? h('button', { class: 'btn sec', type: 'button', onclick: () => formModal({ title: 'تعديل العميل', fields: customerFields(ctx.can, true), initial: cu, wide: true, submit: (v) => api('PATCH', `/customers/${id}`, { body: v }), onDone: load }) }, 'تعديل') : null,
        ctx.can('customers.assign') ? h('button', { class: 'btn sec', type: 'button', onclick: () => formModal({
          title: 'إسناد لمندوب', fields: [{ name: 'representativeId', label: 'المندوب', type: 'select', required: true, load: () => lookup('/representatives', (r) => `${r.employeeCode} — ${r.fullName}`) }],
          submit: (v) => api('POST', `/customers/${id}/assign`, { body: v }), onDone: load }) }, 'إسناد لمندوب') : null,
        ctx.can('payments.create') ? h('button', { class: 'btn', type: 'button', onclick: () => ctx.navigate('/payments?customerId=' + id) }, 'تسجيل تسديد') : null);
      put(holder, tools,
        h('div', { class: 'card' }, kv([
          ['النوع', lbl(L.customerType, cu.customerType)], ['الحالة', badge(lbl(L.customerStatus, cu.status), kind(L.customerStatus, cu.status))], ['الهاتف', cu.phone], ['العنوان', cu.address],
          ['المنطقة', cu.area && cu.area.name], ['المندوب', cu.assignedRepresentative && cu.assignedRepresentative.fullName], ['قائمة الأسعار', cu.priceList && cu.priceList.name],
          ['الحد الائتماني', cu.creditLimit ? fmtNum(cu.creditLimit) : 'بلا حد'], ['آخر زيارة', fmtDate(cu.lastVisitDate)],
          bal ? ['الرصيد الحالي', h('strong', {}, fmtNum(bal.data.balance))] : null, bal ? ['رصيد دائن غير موزّع', fmtNum(bal.data.unallocatedPayments)] : null,
        ])),
        open ? [h('h3', {}, 'الفواتير غير المسددة'), table([
          { key: 'invoiceNumber', label: 'الفاتورة' }, { key: 'invoiceDate', label: 'التاريخ', fmt: fmtDate }, { key: 'netTotal', label: 'الصافي', num: true, fmt: fmtNum },
          { key: 'remainingAmount', label: 'المتبقي', num: true, fmt: fmtNum }, { key: 'ageDays', label: 'العمر (يوم)', num: true }], open.data, { onRowClick: (r) => ctx.navigate('/invoices/' + r.id), empty: 'لا فواتير غير مسددة' })] : null,
        st ? [h('h3', {}, 'كشف الحساب'), h('p', { class: 'note' }, `الرصيد الافتتاحي: ${fmtNum(st.data.openingBalance)} — الرصيد الختامي: ${fmtNum(st.data.closingBalance)}${st.data.truncated ? ' (عُرضت أول 2000 حركة)' : ''}`), table([
          { key: 'entryDate', label: 'التاريخ', fmt: fmtDateTime }, { key: 'entryType', label: 'النوع' }, { key: 'description', label: 'المرجع' },
          { key: 'debit', label: 'مدين', num: true, fmt: (v) => (v ? fmtNum(v) : '') }, { key: 'credit', label: 'دائن', num: true, fmt: (v) => (v ? fmtNum(v) : '') }, { key: 'balance', label: 'الرصيد', num: true, fmt: fmtNum }], st.data.entries)] : null);
    } catch (e) { holder.replaceChildren(errorBox(e)); }
  }
  void toast;
  await load();
}

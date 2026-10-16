import { api } from '../api.js';
import { errorBox, fmtNum, h, spinner, table } from '../dom.js';

export const title = 'لوحة المتابعة';

const kpi = (label, value, sub, cls = '') => h('div', { class: 'kpi ' + cls }, h('div', { class: 'l' }, label), h('div', { class: 'v' }, value), sub ? h('div', { class: 's' }, sub) : null);

export default async function render({ root }) {
  const holder = h('div', {}, spinner());
  root.append(h('div', { class: 'toolbar' }, h('h2', {}, 'لوحة المتابعة'), h('div', { class: 'sp' }), h('button', { class: 'btn sec', type: 'button', onclick: load }, 'تحديث')), holder);
  async function load() {
    holder.replaceChildren(spinner());
    try {
      const { data: d } = await api('GET', '/dashboard');
      holder.replaceChildren(
        h('div', { class: 'grid' },
          kpi('مبيعات اليوم', fmtNum(d.sales.today.amount), `${fmtNum(d.sales.today.invoices)} فاتورة`),
          kpi('مبيعات الشهر', fmtNum(d.sales.month.amount), `${fmtNum(d.sales.month.invoices)} فاتورة`),
          kpi('الصافي بعد المردودات (اليوم)', fmtNum(d.netSales.today), `مردودات: ${fmtNum(d.returns.today.amount)}`),
          kpi('الصافي بعد المردودات (الشهر)', fmtNum(d.netSales.month), `مردودات: ${fmtNum(d.returns.month.amount)}`),
          kpi('التحصيل اليوم', fmtNum(d.collections.today.amount), `${fmtNum(d.collections.today.count)} تسديد`),
          kpi('التحصيل هذا الشهر', fmtNum(d.collections.month.amount), `${fmtNum(d.collections.month.count)} تسديد`),
          kpi('الذمم المدينة', fmtNum(d.receivables.total), `${fmtNum(d.receivables.debtors)} عميل مدين`, d.receivables.total > 0 ? 'warn' : ''),
          kpi('طلبات اليوم', fmtNum(d.orders.today), `بانتظار الاعتماد: ${fmtNum(d.orders.pendingApproval)}`, d.orders.pendingApproval ? 'warn' : ''),
          kpi('المندوبون الفعّالون', fmtNum(d.representatives.active), `زيارات اليوم: ${fmtNum(d.representatives.visitsToday)}`),
          kpi('مخزون منخفض', fmtNum(d.inventory.lowStockProducts), 'منتج دون حد إعادة الطلب', d.inventory.lowStockProducts ? 'warn' : ''),
          kpi('ينتهي خلال 30 يوماً', fmtNum(d.inventory.nearExpiry30d.units), `${fmtNum(d.inventory.nearExpiry30d.batches)} تشغيلة`, d.inventory.nearExpiry30d.batches ? 'warn' : ''),
          kpi('منتهي الصلاحية', fmtNum(d.inventory.expired.units), `${fmtNum(d.inventory.expired.batches)} تشغيلة`, d.inventory.expired.batches ? 'bad' : '')),
        h('h3', {}, 'أفضل العملاء هذا الشهر'), table([{ key: 'code', label: 'الكود' }, { key: 'name', label: 'العميل' }, { key: 'net', label: 'المبيعات', num: true, fmt: fmtNum }], d.topCustomers),
        h('h3', {}, 'أفضل المنتجات هذا الشهر'), table([{ key: 'code', label: 'الرمز' }, { key: 'name', label: 'المنتج' }, { key: 'quantity', label: 'الكمية', num: true, fmt: fmtNum }, { key: 'net', label: 'المبيعات', num: true, fmt: fmtNum }], d.topProducts),
        h('h3', {}, 'أفضل المندوبين هذا الشهر'), table([{ key: 'code', label: 'الكود' }, { key: 'name', label: 'المندوب' }, { key: 'invoices', label: 'الفواتير', num: true }, { key: 'net', label: 'المبيعات', num: true, fmt: fmtNum }], d.topRepresentatives));
    } catch (e) { holder.replaceChildren(errorBox(e)); }
  }
  await load();
}

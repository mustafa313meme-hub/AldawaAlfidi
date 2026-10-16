import { dbAll, dbGet } from '../db.js';
import { badge, fmtDate, fmtDateTime, fmtNum, h, kv, normalizeSearch, put } from '../dom.js';
import { can } from '../session.js';

export const title = 'العملاء';
export const TYPE = { Pharmacy: 'صيدلية', Doctor: 'طبيب', Hospital: 'مستشفى', MedicalCenter: 'مركز طبي', Distributor: 'موزّع', Other: 'أخرى' };
export const STATUS = { Active: ['فعّال', 'ok'], Suspended: ['موقوف', 'warn'], Blocked: ['محظور', 'bad'], Inactive: ['غير فعّال', 'bad'] };

export default async function render(ctx) {
  const [customers, balances] = await Promise.all([dbAll('customers'), dbAll('balances')]);
  const bal = new Map(balances.map((b) => [b.customerId, b.balance]));
  const list = h('div', { class: 'cards' });
  const search = h('input', { type: 'search', placeholder: 'ابحث بالاسم أو الكود أو الهاتف', 'aria-label': 'بحث', oninput: () => draw() });
  ctx.root.append(h('h2', {}, 'العملاء'), h('div', { class: 'searchbar' }, search), list, h('p', { class: 'note' }, `${fmtNum(customers.length)} عميل محفوظ على هذا الجهاز`));
  function draw() {
    const q = normalizeSearch(search.value);
    const rows = customers.filter((c) => !q || normalizeSearch(`${c.name} ${c.code} ${c.phone || ''} ${c.ownerName || ''} ${c.address || ''}`).includes(q)).sort((a, b) => a.name.localeCompare(b.name, 'ar')).slice(0, 100);
    if (!rows.length) { put(list, h('div', { class: 'empty' }, customers.length ? 'لا نتائج' : 'لا عملاء بعد. اضغط «مزامنة» لتنزيل عملائك.')); return; }
    put(list, rows.map((c) => {
      const b = bal.get(c.id);
      return h('a', { class: 'card item', href: '#/customers/' + c.id }, h('div', { class: 'grow' }, h('strong', {}, c.name), h('div', { class: 'note' }, `${c.code} · ${TYPE[c.customerType] || ''}${c.address ? ' · ' + c.address : ''}`)),
        b ? h('div', { class: 'bal' + (b > 0 ? ' due' : '') }, fmtNum(b)) : null, c.status !== 'Active' ? badge(...(STATUS[c.status] || [c.status, ''])) : null);
    }));
  }
  draw();
}

export async function detail(ctx) {
  const c = await dbGet('customers', ctx.params.id);
  if (!c) { ctx.root.append(h('div', { class: 'errbox' }, 'العميل غير موجود على هذا الجهاز (ربما أُعيد إسناده).')); return; }
  const [b, invoices, outbox] = await Promise.all([dbGet('balances', c.id), dbAll('openInvoices'), dbAll('outbox')]);
  const open = invoices.filter((i) => i.customerId === c.id).sort((x, y) => String(x.invoiceDate).localeCompare(String(y.invoiceDate)));
  const pend = outbox.filter((o) => o.customerId === c.id && o.status !== 'Applied' && o.status !== 'Discarded').sort((x, y) => y.createdAt.localeCompare(x.createdAt));
  const st = STATUS[c.status] || [c.status, ''];
  const q = '?customerId=' + encodeURIComponent(c.id);
  const act = (perm, label, path, cls = '') => (can(perm) ? h('a', { class: 'btn ' + cls, href: '#' + path + q }, label) : null);
  const blocked = c.status !== 'Active';
  ctx.root.append(...[
    h('h2', {}, c.name),
    h('div', { class: 'card' }, kv([
      ['الكود', c.code], ['الحالة', badge(...st)], ['النوع', TYPE[c.customerType]], ['الهاتف', c.phone ? h('a', { href: 'tel:' + c.phone.replace(/[^\d+]/g, '') }, c.phone) : null], ['العنوان', c.address],
      ['صاحب/طبيب', c.ownerName], ['الحد الائتماني', c.creditLimit ? fmtNum(c.creditLimit) : 'بلا حد'], ['الرصيد (آخر مزامنة)', b ? h('strong', {}, fmtNum(b.balance)) : '—'],
      c.latitude != null ? ['الموقع', h('a', { href: `https://www.google.com/maps?q=${Number(c.latitude)},${Number(c.longitude)}`, target: '_blank', rel: 'noopener noreferrer' }, 'فتح الخريطة')] : null,
    ])),
    blocked ? h('div', { class: 'errbox' }, 'هذا العميل غير فعّال؛ لا يمكن إنشاء طلبات له.') : null,
    h('div', { class: 'actions grid2' }, act('visits.create', 'تسجيل زيارة', '/visit/new'), blocked ? null : act('orders.create', 'طلب جديد', '/order/new'), act('payments.create', 'تسديد', '/payment/new', 'sec'), act('returns.create', 'مردود', '/return/new', 'sec')),
    pend.length ? [h('h3', {}, 'عمليات لم تُعتمد بعد'), h('div', { class: 'cards' }, pend.map((o) => h('div', { class: 'card item' }, h('div', { class: 'grow' }, o.summary || o.type, h('div', { class: 'note' }, fmtDateTime(o.createdAt))), badge(o.status === 'Conflict' ? 'بانتظار الإدارة' : o.status === 'Rejected' ? 'مرفوضة' : 'بانتظار الإرسال', o.status === 'pending' ? 'warn' : 'bad')))), h('p', { class: 'note' }, 'الرصيد أعلاه لا يشمل هذه العمليات حتى تُرسل وتُزامَن.')] : null,
    h('h3', {}, 'الفواتير غير المسددة'),
    open.length ? h('div', { class: 'cards' }, open.map((i) => h('div', { class: 'card item' }, h('div', { class: 'grow' }, h('strong', {}, i.invoiceNumber), h('div', { class: 'note' }, `${fmtDate(i.invoiceDate)} · الصافي ${fmtNum(i.netTotal)}`)), h('div', { class: 'bal due' }, fmtNum(i.remainingAmount)),
      can('payments.create') ? h('a', { class: 'btn sm sec', href: `#/payment/new${q}&invoiceId=${encodeURIComponent(i.id)}` }, 'تسديد') : null))) : h('div', { class: 'empty' }, 'لا فواتير غير مسددة'),
  ].flat(Infinity).filter((x) => x !== null && x !== undefined && x !== false));
}

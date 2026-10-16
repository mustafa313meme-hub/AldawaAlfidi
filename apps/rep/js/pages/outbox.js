import { badge, confirmDialog, fmtDateTime, h, put, toast } from '../dom.js';
import { dbAll } from '../db.js';
import { dismissOp, retryOp, syncNow, syncState } from '../sync.js';

export const title = 'المزامنة';
const ST = {
  pending: ['بانتظار الإرسال', 'warn'], Processing: ['قيد المعالجة', 'warn'], Failed: ['تعذّر مؤقتاً — ستُعاد', 'warn'],
  Applied: ['مُعتمَدة', 'ok'], Conflict: ['بانتظار مراجعة الإدارة', 'bad'], Rejected: ['مرفوضة', 'bad'], Discarded: ['تجاهلتها الإدارة', ''],
};
const TYPE = { visit: 'زيارة', order: 'طلب', payment: 'تسديد', return: 'مردود' };

export default async function render(ctx) {
  const status = h('div', { class: 'card', 'aria-live': 'polite' });
  const list = h('div', { class: 'cards' });
  const btn = h('button', { class: 'btn big', type: 'button', onclick: async () => {
    btn.disabled = true; btn.textContent = 'جارٍ المزامنة…';
    const r = await syncNow();
    btn.disabled = false; btn.textContent = 'مزامنة الآن';
    if (r.ok) toast('تمت المزامنة', 'ok'); else toast(syncState().error || 'فشلت المزامنة', 'bad');
    await draw();
  } }, 'مزامنة الآن');
  ctx.root.append(h('h2', {}, 'المزامنة'), status, btn, h('h3', {}, 'العمليات'), list);

  async function draw() {
    const s = syncState();
    put(status, h('div', {}, s.lastOkAt ? `آخر مزامنة ناجحة: ${fmtDateTime(s.lastOkAt)}` : 'لم تتم مزامنة بعد'), s.pending ? h('div', {}, `${s.pending} عملية بانتظار الإرسال`) : h('div', { class: 'note' }, 'لا عمليات معلّقة'), s.error ? h('div', { class: 'err' }, s.error) : null,
      Math.abs(s.skewMs) > 240_000 ? h('div', { class: 'err' }, 'ساعة جهازك تختلف عن الخادم بأكثر من 4 دقائق؛ قد تُرفض الزيارات والتسديدات. صحّح التاريخ والوقت.') : null);
    const ops = (await dbAll('outbox')).sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 100);
    put(list, ops.length ? ops.map((o) => {
      const [txt, kind] = ST[o.status] || [o.status, ''];
      return h('div', { class: 'card' },
        h('div', { class: 'item' }, h('div', { class: 'grow' }, h('strong', {}, o.summary || TYPE[o.type]), h('div', { class: 'note' }, `${TYPE[o.type] || o.type} · ${fmtDateTime(o.createdAt)}`)), badge(txt, kind)),
        o.error ? h('div', { class: 'err' }, o.error.message || o.error.code) : null,
        o.status === 'Conflict' ? h('div', { class: 'note' }, 'لم تُفقد: محفوظة عند الإدارة لتقرّر إعادة المحاولة أو التجاهل. أبلغ مشرفك.') : null,
        o.status === 'Failed' || o.status === 'Processing' ? h('button', { class: 'btn sec sm', type: 'button', onclick: async () => { await retryOp(o.localId); await draw(); } }, 'أعد المحاولة') : null,
        o.status === 'Rejected' || o.status === 'Conflict' ? h('button', { class: 'btn sec sm', type: 'button', onclick: async () => { if (await confirmDialog('إخفاء هذه العملية من جهازك؟ (لم تُنفَّذ على الخادم)', { okLabel: 'إخفاء' })) { await dismissOp(o.localId); await draw(); } } }, 'إخفاء من جهازي') : null);
    }) : h('div', { class: 'empty' }, 'لا عمليات'));
  }
  const on = () => { if (document.body.contains(status)) draw(); else window.removeEventListener('sync-state', on); };
  window.addEventListener('sync-state', on);
  await draw();
}

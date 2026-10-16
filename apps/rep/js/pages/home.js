import { api } from '../api.js';
import { dbAll } from '../db.js';
import { badge, errText, fmtNum, h, put, todayLocal, toast } from '../dom.js';

export const title = 'اليوم';
const PLAN = { Planned: ['مخطَّطة', 'warn'], Done: ['تمت', 'ok'], Skipped: ['متخطّاة', ''], Cancelled: ['ملغاة', 'bad'] };

export default async function render(ctx) {
  const today = todayLocal();
  const [plans, customers, outbox, balances] = await Promise.all([dbAll('visitPlans'), dbAll('customers'), dbAll('outbox'), dbAll('balances')]);
  const byId = new Map(customers.map((c) => [c.id, c]));
  const myToday = plans.filter((p) => String(p.planDate).slice(0, 10) === today).sort((a, b) => a.plannedOrder - b.plannedOrder);
  const visitedToday = new Set(outbox.filter((o) => o.type === 'visit' && o.status !== 'Rejected' && o.createdAt && new Date(o.createdAt).getTime() > Date.now() - 36 * 3600_000 && o.payload && o.payload.customerId).map((o) => o.payload.customerId));
  const opsToday = outbox.filter((o) => o.createdAt && todayLocal(new Date(o.createdAt)) === today);
  const count = (t) => opsToday.filter((o) => o.type === t && o.status !== 'Rejected' && o.status !== 'Discarded').length;
  const debt = balances.reduce((a, b) => a + Math.max(0, b.balance), 0);

  const tiles = h('div', { class: 'tiles' },
    tile('زيارات اليوم', count('visit')), tile('طلبات اليوم', count('order')), tile('تسديدات اليوم', count('payment')), tile('عملائي', customers.length), tile('ذمم عملائي', fmtNum(debt)));
  const list = h('div', { class: 'cards' });
  ctx.root.append(h('h2', {}, 'خطة اليوم'), tiles, list);

  const draw = (rows) => {
    if (!rows.length) { put(list, h('div', { class: 'empty' }, 'لا توجد خطة زيارة لليوم. يمكنك تسجيل زيارة من صفحة أي عميل.')); return; }
    put(list, rows.map((p) => {
      const c = byId.get(p.customerId);
      const doneLocal = p.status === 'Planned' && visitedToday.has(p.customerId);
      const [txt, kind] = doneLocal ? ['تمت (بانتظار الإرسال)', 'ok'] : PLAN[p.status] || [p.status, ''];
      return h('div', { class: 'card item' },
        h('a', { class: 'grow', href: c ? '#/customers/' + c.id : null }, h('strong', {}, c ? c.name : 'عميل غير متاح'), h('div', { class: 'note' }, c ? [c.address || '', c.phone ? ' · ' + c.phone : ''] : '')),
        badge(txt, kind),
        p.status === 'Planned' && !doneLocal ? h('button', { class: 'btn sec sm', type: 'button', onclick: async (e) => {
          const b = e.currentTarget; b.disabled = true;
          try { await api('PATCH', `/visit-plans/${p.id}/status`, { body: { status: 'Skipped' } }); p.status = 'Skipped'; draw(rows); toast('تم التخطّي', 'ok'); } catch (ex) { toast(ex.network ? 'التخطّي يحتاج اتصالاً بالخادم' : errText(ex), 'bad'); b.disabled = false; }
        } }, 'تخطّي') : null);
    }));
  };
  draw(myToday);
}

const tile = (l, v) => h('div', { class: 'tile' }, h('div', { class: 'v' }, String(v)), h('div', { class: 'l' }, l));

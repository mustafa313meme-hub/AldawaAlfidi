import { api } from '../api.js';
import { errorBox, fmtDateTime, h, spinner, toast } from '../dom.js';

export const title = 'الإشعارات';

export default async function render(ctx) {
  const holder = h('div', {}, spinner());
  const all = h('button', { class: 'btn sec', type: 'button', onclick: async () => { try { await api('POST', '/notifications/read-all'); toast('تم', 'ok'); load(); } catch (e) { toast(e.message, 'bad'); } } }, 'تعليم الكل كمقروء');
  ctx.root.append(h('div', { class: 'toolbar' }, h('h2', {}, 'الإشعارات'), h('div', { class: 'sp' }), all), holder);
  async function load() {
    holder.replaceChildren(spinner());
    try {
      const { data } = await api('GET', '/notifications', { query: { pageSize: 50 } });
      holder.replaceChildren(...(data.length ? data.map((n) => h('div', { class: 'card' }, h('strong', {}, n.title), n.readAt ? null : h('span', { class: 'badge warn' }, ' جديد'), h('div', {}, n.body), h('div', { class: 'note' }, fmtDateTime(n.createdAt),
        n.readAt ? null : [' — ', h('a', { href: '#/notifications', onclick: async (e) => { e.preventDefault(); try { await api('POST', `/notifications/${n.id}/read`); load(); } catch { /* ignore */ } } }, 'تعليم كمقروء')]))) : [h('p', { class: 'note' }, 'لا إشعارات')]));
    } catch (e) { holder.replaceChildren(errorBox(e)); }
  }
  await load();
}

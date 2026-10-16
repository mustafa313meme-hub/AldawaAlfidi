// Customer map without map tiles (third-party content is blocked by the CSP): an SVG scatter of the customers' coordinates,
// a clickable list, and a link per customer to open the real map app. Radius search sends lat/lng to the API.
import { api, lookup } from '../api.js';
import { badge, errorBox, fmtNum, h, put, spinner } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { mapLink } from './visits.js';

export const title = 'خريطة العملاء';
const NS = 'http://www.w3.org/2000/svg';
const svg = (tag, attrs = {}, ...kids) => { const e = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v)); for (const k of kids.flat()) if (k) e.append(k instanceof Node ? k : document.createTextNode(String(k))); return e; };


export default async function render(ctx) {
  const areas = await lookup('/areas', (a) => `${a.city} — ${a.name}`).catch(() => []);
  const mk = (label, el) => h('label', { class: 'f' }, label, el);
  const area = h('select', { 'aria-label': 'المنطقة' }, h('option', { value: '' }, 'كل المناطق'), areas.map((a) => h('option', { value: a.value }, a.label)));
  const status = h('select', { 'aria-label': 'الحالة' }, h('option', { value: '' }, 'كل الحالات'), Object.entries(L.customerStatus).map(([v, l]) => h('option', { value: v }, l)));
  const lat = h('input', { type: 'number', step: 'any', placeholder: '33.31', 'aria-label': 'خط العرض' });
  const lng = h('input', { type: 'number', step: 'any', placeholder: '44.36', 'aria-label': 'خط الطول' });
  const radius = h('input', { type: 'number', min: 50, max: 50000, value: 5000, 'aria-label': 'نصف القطر (م)' });
  const out = h('div');
  ctx.root.append(h('h2', {}, 'خريطة العملاء'),
    h('div', { class: 'toolbar' }, mk('المنطقة', area), mk('الحالة', status), mk('قرب خط العرض', lat), mk('قرب خط الطول', lng), mk('نصف القطر (م)', radius), h('button', { class: 'btn', type: 'button', onclick: () => load() }, 'عرض')),
    h('p', { class: 'note' }, 'يُعرض العملاء الذين لديهم إحداثيات فقط (حتى 2000). اترك الإحداثيات فارغة لعرض الكل.'), out);

  async function load() {
    out.replaceChildren(spinner());
    try {
      if ((lat.value === '') !== (lng.value === '')) throw Object.assign(new Error('أدخل خط العرض وخط الطول معاً أو اتركهما فارغين'), { status: 400 });
      const { data } = await api('GET', '/customers/map', { query: { areaId: area.value, status: status.value, lat: lat.value, lng: lng.value, radiusM: lat.value !== '' ? radius.value : undefined } });
      draw(data);
    } catch (e) { out.replaceChildren(errorBox(e)); }
  }

  function draw(rows) {
    if (!rows.length) { put(out, h('div', { class: 'tbl-wrap' }, h('div', { class: 'empty' }, 'لا عملاء بإحداثيات ضمن هذا الفلتر'))); return; }
    const W = 760, H = 420, P = 28;
    const lats = rows.map((r) => Number(r.latitude)), lngs = rows.map((r) => Number(r.longitude));
    const minLa = Math.min(...lats), maxLa = Math.max(...lats), minLo = Math.min(...lngs), maxLo = Math.max(...lngs);
    const kx = Math.cos(((minLa + maxLa) / 2) * Math.PI / 180); // keep east-west distances proportional
    const spanX = Math.max((maxLo - minLo) * kx, 1e-6), spanY = Math.max(maxLa - minLa, 1e-6);
    const scale = Math.min((W - 2 * P) / spanX, (H - 2 * P) / spanY);
    const ox = (W - spanX * scale) / 2, oy = (H - spanY * scale) / 2;
    const px = (lo) => ox + (lo - minLo) * kx * scale;
    const py = (la) => H - (oy + (la - minLa) * scale);
    const detail = h('div', { class: 'card', 'aria-live': 'polite' }, 'اضغط على نقطة لعرض العميل.');
    const pick = (r) => { put(detail, h('strong', {}, `${r.code} — ${r.name}`), h('div', {}, `${lbl(L.customerType, r.customerType)} · `, badge(lbl(L.customerStatus, r.status), kind(L.customerStatus, r.status))), h('div', {}, r.address || ''), h('div', {}, mapLink(r.latitude, r.longitude)), r.distanceM != null ? h('div', { class: 'note' }, `يبعد ${fmtNum(r.distanceM)} م`) : null, h('a', { href: '#/customers/' + r.id }, 'فتح ملف العميل')); };
    const dots = rows.map((r) => {
      const c = svg('circle', { cx: px(Number(r.longitude)).toFixed(1), cy: py(Number(r.latitude)).toFixed(1), r: 6, class: 'dot st-' + r.status, tabindex: 0, role: 'button', 'aria-label': r.name, 'data-id': r.id }, svg('title', {}, `${r.code} — ${r.name}`));
      c.addEventListener('click', () => pick(r));
      c.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(r); } });
      return c;
    });
    const chart = svg('svg', { viewBox: `0 0 ${W} ${H}`, class: 'map-svg', role: 'img', 'aria-label': 'توزيع العملاء' }, svg('rect', { x: 0, y: 0, width: W, height: H, class: 'map-bg', rx: 10 }), svg('text', { x: W - 10, y: 18, 'text-anchor': 'end', class: 'map-note' }, 'الشمال ↑'), dots);
    const legend = h('div', { class: 'legend' }, Object.entries(L.customerStatus).map(([k, l]) => h('span', {}, h('i', { class: 'st-' + k }), l)));
    put(out, h('div', { class: 'rep-split map' }, h('div', {}, h('div', { class: 'card' }, chart, legend), h('p', { class: 'note' }, `${fmtNum(rows.length)} عميل`)), detail),
      h('div', { class: 'tbl-wrap' }, h('table', {}, h('thead', {}, h('tr', {}, ['الكود', 'العميل', 'العنوان', 'الإحداثيات', rows[0].distanceM != null ? 'البعد (م)' : null].filter(Boolean).map((t) => h('th', {}, t)))),
        h('tbody', {}, rows.slice(0, 300).map((r) => h('tr', { class: 'click', onclick: () => pick(r) }, h('td', {}, r.code), h('td', {}, r.name), h('td', {}, r.address || ''), h('td', {}, mapLink(r.latitude, r.longitude)), r.distanceM != null ? h('td', { class: 'num' }, fmtNum(r.distanceM)) : null))))));
  }
  await load();
}

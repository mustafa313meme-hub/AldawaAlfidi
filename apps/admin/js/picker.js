import { api } from './api.js';
import { h } from './dom.js';

/** Search-as-you-type picker. `label(row)` builds the text. `current` is the chosen row (or null). */
export function picker({ endpoint, query = {}, label, placeholder = 'ابحث…', onPick, searchKey = 'q', minChars = 2 }) {
  let current = null;
  let timer;
  const list = h('div', { class: 'pick-list', hidden: true });
  const chosen = h('div', { class: 'chosen' });
  const input = h('input', { type: 'search', placeholder, autocomplete: 'off', 'aria-label': placeholder, oninput: () => {
    clearTimeout(timer);
    const q = input.value.trim();
    if (q.length < minChars) { list.hidden = true; return; }
    timer = setTimeout(async () => {
      try {
        const { data } = await api('GET', endpoint, { query: { pageSize: 8, ...query, [searchKey]: q } });
        list.replaceChildren(...(data.length ? data.map((r) => h('button', { type: 'button', onclick: () => pick(r) }, label(r))) : [h('div', { class: 'empty' }, 'لا نتائج')]));
        list.hidden = false;
      } catch { list.hidden = true; }
    }, 250);
  } });
  function pick(r) { current = r; chosen.textContent = '✓ ' + label(r); input.value = ''; list.hidden = true; if (onPick) onPick(r); }
  return { el: h('div', { class: 'pick' }, input, list, chosen), get value() { return current; }, set(r) { if (r) pick(r); } };
}

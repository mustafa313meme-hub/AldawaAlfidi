import { fmtDateTime, h, kv, modal } from '../dom.js';
import { api } from '../api.js';
import { resourceList } from '../resource.js';

export const title = 'سجل التدقيق';

const ENTITIES = ['user', 'session', 'customer', 'product', 'company', 'category', 'price_list', 'warehouse', 'representative', 'area', 'visit', 'order', 'invoice', 'return', 'payment', 'purchase', 'transfer', 'adjustment', 'stock', 'bonus_rule', 'setting', 'role', 'sync_operation', 'device'];

export default async function render(ctx) {
  void api;
  await resourceList({
    title: 'سجل التدقيق (للقراءة فقط)', endpoint: '/audit-logs', filters: [{ name: 'entity', label: 'الكيان', options: ENTITIES.map((v) => ({ value: v, label: v })) }],
    columns: [{ key: 'createdAt', label: 'الوقت', fmt: fmtDateTime }, { key: 'action', label: 'العملية' }, { key: 'entity', label: 'الكيان' }, { key: 'entityId', label: 'المعرّف' }, { key: 'userId', label: 'المستخدم' }, { key: 'ip', label: 'IP' }],
    onRow: (r) => modal({ title: r.action, wide: true, body: h('div', {}, kv([['الوقت', fmtDateTime(r.createdAt)], ['الكيان', `${r.entity} ${r.entityId || ''}`], ['المستخدم', r.userId], ['الجهاز', r.device]]),
      r.oldValues ? [h('h3', {}, 'قبل'), h('pre', { class: 'json' }, JSON.stringify(r.oldValues, null, 2))] : null, r.newValues ? [h('h3', {}, 'بعد'), h('pre', { class: 'json' }, JSON.stringify(r.newValues, null, 2))] : null),
    actions: [{ label: 'إغلاق', kind: 'sec', onClick: (c) => c() }] }),
  })(ctx);
}

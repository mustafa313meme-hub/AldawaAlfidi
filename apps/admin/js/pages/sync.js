import { api } from '../api.js';
import { badge, fmtDateTime, h, kv, modal, promptDialog, toast } from '../dom.js';
import { kind, L, lbl } from '../labels.js';
import { resourceList } from '../resource.js';

export const title = 'طابور المزامنة';

export default async function render(ctx) {
  ctx.root.append(h('p', { class: 'note' }, 'عمليات المندوبين التي لم تُطبَّق تلقائياً. لا تُحذف أي عملية: «إعادة المحاولة» تنفّذها بصلاحيات مستخدمها الأصلي بعد إصلاح السبب، و«تجاهل» يتطلب سبباً.'));
  await resourceList({
    title: 'عمليات المزامنة', endpoint: '/sync/conflicts',
    filters: [{ name: 'status', label: 'الحالة', options: ['Conflict', 'Rejected', 'Failed', 'Discarded', 'Applied'].map((v) => ({ value: v, label: lbl(L.syncStatus, v) })) }],
    columns: [
      { key: 'createdAt', label: 'الوقت', fmt: fmtDateTime }, { key: 'opType', label: 'النوع', fmt: (v) => lbl(L.opType, v) }, { key: 'status', label: 'الحالة', render: (r) => badge(lbl(L.syncStatus, r.status), kind(L.syncStatus, r.status)) },
      { key: 'errorCode', label: 'السبب' }, { key: 'errorMessage', label: 'الرسالة' }, { key: 'attempts', label: 'المحاولات', num: true },
    ],
    onRow: async (r, reload) => {
      const { data: op } = await api('GET', `/sync/conflicts/${r.id}`);
      const act = async (action) => {
        let note;
        if (action === 'discard') { note = await promptDialog('سبب تجاهل العملية'); if (!note) return false; }
        try { const res = await api('POST', `/sync/conflicts/${r.id}/resolve`, { body: { action, note } }); toast(action === 'retry' ? `النتيجة: ${lbl(L.syncStatus, res.data.status)}` : 'تم التجاهل', 'ok'); reload(); return true; } catch (e) { toast(e.message, 'bad'); return false; }
      };
      modal({ title: `عملية ${lbl(L.opType, op.opType)}`, wide: true,
        body: h('div', {}, kv([['المستخدم', op.user && `${op.user.fullName} (${op.user.username})`], ['الجهاز', op.deviceId], ['الحالة', lbl(L.syncStatus, op.status)], ['السبب', op.errorCode], ['الرسالة', op.errorMessage], ['المحاولات', op.attempts], ['وقت الإنشاء على الجهاز', fmtDateTime(op.clientCreatedAt)], ['القرار', op.resolution && `${op.resolution}${op.resolutionNote ? ' — ' + op.resolutionNote : ''}`]]),
          op.errorDetails ? [h('h3', {}, 'تفاصيل الخطأ'), h('pre', { class: 'json' }, JSON.stringify(op.errorDetails, null, 2))] : null, h('h3', {}, 'محتوى العملية'), h('pre', { class: 'json' }, JSON.stringify(op.payload, null, 2))),
        actions: [
          ['Conflict', 'Failed'].includes(op.status) ? { label: 'إعادة المحاولة', onClick: async (close) => { if (await act('retry')) close(); } } : null,
          ['Conflict', 'Rejected', 'Failed'].includes(op.status) ? { label: 'تجاهل', kind: 'bad', onClick: async (close) => { if (await act('discard')) close(); } } : null,
          { label: 'إغلاق', kind: 'sec', onClick: (c) => c() }].filter(Boolean) });
    },
  })(ctx);
}

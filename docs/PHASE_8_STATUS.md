# Phase 8 — Sync & Offline API: Status

## Completed (مكتوب في الكود)
- **Push** `POST /sync/push` (يتطلب `x-device-id`): دفعة حتى 100 عملية من `visit | order | payment | return`، تُنفَّذ بالخدمات الأصلية نفسها (فنفس القواعد: النطاق، الأسعار، الائتمان، الموقع...)، ونتيجة مستقلة لكل عملية. صلاحية كل نوع تُفحص (`visits.create`, `orders.create`, `payments.create`, `returns.create`).
- **Idempotency:** مفتاح `deviceId + localId` فريد؛ إعادة الإرسال تعيد النتيجة المخزَّنة (`duplicate: true`)، والعملية الجارية تُرجع `Processing`، والعملية العالقة أكثر من دقيقتين تُعاد، وكل الخدمات تحمي نفسها بالمفتاح ذاته.
- **طابور التعارضات:** كل عملية تُخزَّن بحمولتها ولا تُحذف. `Conflict` (قاعدة عمل) و`Rejected` (غير صالح/غير مسموح) و`Failed` (خطأ مؤقت، 5 محاولات).
  - `GET /sync/conflicts` و`/conflicts/:id` و`POST /sync/conflicts/:id/resolve` (`retry` بصلاحيات المستخدم الأصلي، أو `discard` بملاحظة إلزامية) — Audit كامل.
- **حالة الجهاز:** `GET /sync/status` (عدّادات + العمليات التي لم تنجح وأسبابها)، `GET /sync/manifest`، `GET /sync/time` (فحص انحراف الساعة).
- **Pull (Delta):** `GET /sync/pull/{customers|removedCustomers|balances|products|categories|companies|areas|bonusRules|priceLists|priceListItems|visitPlans|openInvoices|settings}?since=&cursor=&limit=` — keyset على `(updatedAt, id)` وتداخل 60 ثانية، ونطاق المندوب (عملاؤه فقط)، والأسعار حسب الصلاحية.
- **Idempotency-Key** على `POST /invoices`.
- **قاعدة البيانات:** `sync_operations`، و`invoices.updatedAt` و`idempotencyKey` (فريد مع المنشئ).
- **صلاحيات:** `sync.use`, `sync.manage` (86 صلاحية).
- **اختبارات:** `sync-logic.spec.ts` (8: تصنيف الأخطاء، الـ cursors، الترقيم). **شغّلت اختبارات المنطق النقي من المراحل 1-8 معاً: 96 اختباراً نجحت، 0 فشل.**

## بروتوكول الجهاز (للتطبيق)
1. **Offline:** كل عملية تُحفظ محلياً بـ `localId` (UUID) و`createdAt` وحالة `pending` وعدد محاولات.
2. **عند عودة الإنترنت:** `POST /sync/push` بالعمليات مرتبةً بوقت الإنشاء. لكل نتيجة: `Applied` → احذف محلياً أو علّم منجزاً؛ `Duplicate/Processing` → أعد السؤال لاحقاً؛ `Failed` → أعد لاحقاً؛ `Conflict/Rejected` → اعرضها للمندوب («بانتظار مراجعة الإدارة») ولا تحذفها.
3. **التنزيل:** لكل كيان: `GET /sync/pull/:entity?since=<serverTime السابق>` ثم تابع `nextCursor` (مع `since` نفسه) حتى `null`، واحفظ `serverTime` **الصفحة الأولى** كـ `since` التالي. اعمل upsert بالمعرّف. احذف عملاء `removedCustomers`.
4. `priceLists[].itemCount` ≠ العدد المحلي ⇒ نزّل `priceListItems` كاملة.
5. اضبط الساعة: قارن `GET /sync/time` بساعة الجهاز؛ الخادم يرفض زيارة/تسديداً مستقبلياً بأكثر من 5 دقائق.

## Pending — الأهم
- **لم يُشغَّل المشروع** (لا قاعدة بيانات ولا شبكة هنا). اختبر بعد التشغيل:
  1. إرسال الدفعة نفسها مرتين ⇒ لا تكرار في الزيارات/الطلبات/التسديدات، والنتيجة الثانية `duplicate: true`.
  2. إرسال دفعتين متوازيتين بنفس العملية.
  3. زيارة لعميل أُعيد إسناده قبل المزامنة ⇒ تظهر `Conflict` (`CUSTOMER_NOT_ASSIGNED`) ثم `retry` بعد إعادة الإسناد.
  4. تسديد لفاتورة سُدّدت ⇒ `Conflict` ولا يُنشأ تسديد.
  5. `pull` كامل ثم Delta بعد تعديل عميل/منتج/تسديد، وعميل أُعيد إسناده يظهر في `removedCustomers`.
  6. `accounting/reconcile` و`inventory/reconcile` بعد كل ما سبق.
- تطبيق الموبايل نفسه (Flutter + قاعدة محلية) — الـ API فقط جاهز.
- تحرير/إنشاء العملاء Offline، تخطّي الخطة Offline، عمليات الدفع بتجميع (batch ضغط)، وإشعارات Push بوجود تعارض.
- الدمج على مستوى الحقول (لا حاجة حالياً).

## تشغيل
```bash
cd apps/api
npx prisma migrate dev --name phase8_sync
npm run db:deploy && npm run db:seed && npm test
```

## نقاط API الجديدة — `/api/v1`
`sync/push` · `sync/pull/:entity` · `sync/status` · `sync/manifest` · `sync/time` · `sync/conflicts` (+`:id`, `:id/resolve`) · `Idempotency-Key` على `invoices`

## Next: Phase 9 — Mobile Polish (تصحيح: واجهات الإدارة والموبايل ليست ضمن مراحل SRS)
الإشعارات وفحص إصدار التطبيق (SRS §110). انظر docs/PHASE_9_STATUS.md.

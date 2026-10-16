# Phase 9 — Mobile Polish (الجانب الخادمي): Status

> **تصحيح:** في ملفات سابقة سمّيتُ بناء واجهة الإدارة وتطبيق المندوب «Phase 9». حسب SRS §110: Phase 9 = Mobile Polish (UX، إشعارات، باركود، GPS)، وPhase 10 = Testing & Production. الواجهتان مطلوبتان في §117 لكنهما **عمل منفصل لم يبدأ**.

## Completed (مكتوب في الكود)
- **الإشعارات (Inbox):** `GET /notifications` (مع `unreadOnly`)، `/notifications/unread-count`، `POST /notifications/:id/read` و`/read-all`. كل مستخدم يرى إشعاراته فقط.
- **مولّدات الإشعارات** (`POST /notifications/run-checks` أو تلقائياً كل 6 ساعات عند `NOTIFICATIONS_JOB=true`):
  - تنبيه الصلاحية (المنتهي + ما ينتهي خلال 30 يوماً) ← لمن يملك `reports.inventory`.
  - المخزون المنخفض ← لنفس الفئة.
  - العملاء المتأخرون في السداد ← لكل مندوب (عملاؤه فقط، حسب `overdue_days`).
  - تعارض مزامنة جديد ← لمن يملك `sync.manage`.
  - اعتماد أو إلغاء الطلب ← للمستخدم الذي أنشأه.
  - إشعار واحد يومياً لكل نوع مهما تكرر التشغيل أو تعددت الخوادم (`dedupeKey`).
- **Push:** واجهة `PushSender` وتوكنات الأجهزة محفوظة؛ `PUSH_PROVIDER=log` للتحقق. **Firebase (FCM) غير مبني.**
- **فحص إصدار التطبيق:** `GET /app/version?platform=&version=` (عام)، والإعداد `app_versions` في `PUT /settings/app_versions`. رفض الإصدار الأقل من `minSupported` عند الدخول والمزامنة بـ HTTP 426 «يرجى تحديث التطبيق للاستمرار». رقم البناء `buildNumber` يُحفظ مع الجهاز.
- **الباركود:** `GET /products/by-barcode/:barcode` (Phase 2) وحقل الباركود ضمن `sync/pull/products`؛ المسح نفسه في التطبيق.
- **GPS:** تقييم الموقع ومنع الزيارات الوهمية اختيارياً (Phase 3).
- **اختبارات:** `version.spec.ts` (8). **كل اختبارات المنطق النقي (المراحل 1-10): 104 اختبارات نجحت، 0 فشل.**

## Pending
- **لم يُشغَّل شيء** (لا شبكة/قاعدة بيانات).
- تطبيق المندوب (Flutter) نفسه: شاشات، خريطة، ماسح باركود، قاعدة محلية، محرك المزامنة (البروتوكول في `PHASE_8_STATUS.md`)، تحسين UX (SRS §75).
- Push الفعلي عبر Firebase، وتفضيلات الإشعارات لكل مستخدم، وإشعار «تأخر عن هدف الشهر».
- الرسائل عربية فقط (لا تعدد لغات).

## تشغيل
```bash
cd apps/api
npx prisma migrate dev --name phase9_notifications
npm run db:deploy && npm run db:seed && npm test
```

## نقاط API الجديدة — `/api/v1`
`notifications` (+`unread-count`, `read-all`, `:id/read`, `run-checks`) · `app/version` · ترويستا `x-app-version` و`x-platform`

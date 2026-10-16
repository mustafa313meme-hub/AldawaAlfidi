# Phase 7 — Reports & Dashboards: Status

## Completed (مكتوب في الكود)
كل تقرير يقبل `?format=csv` لتنزيل ملف يفتح في Excel بالعربية، وفلاتر: `from`, `to`, `representativeId`, `areaId`, `customerId`, `productId`, `companyId`, `warehouseId`, `limit`.

**المبيعات** (`reports.sales`)
- `GET /reports/sales/daily` و`/monthly` (إجمالي، خصم، ضريبة، صافي، بونص، مردودات، الصافي بعد المردودات).
- `GET /reports/sales/by/{representative|area|customer|product|company}`.
- `GET /reports/returns/by/{customer|representative|product|invoice}` (مع التالف/المنتهي وقيمة البونص المحاسَب عليه).

**المالية** (`reports.financial`)
- `GET /reports/financial/receivables` (أرصدة العملاء، تجاوز الحد الائتماني، إجمالي الذمم والأرصدة الدائنة).
- `GET /reports/financial/aging` (0-30 / 31-60 / 61-90 / +90).
- `GET /reports/financial/outstanding-invoices` و`/collections` (التحصيل اليومي حسب الطريقة).

**المخزون** (`reports.inventory`؛ التكلفة تظهر فقط لمن يملك `products.view_cost`)
- `GET /reports/inventory/current` (مع `lowOnly=true`)، و`/movement` (أول المدة/وارد/صادر/آخر المدة)، و`/movers?kind=fast|slow&days=`.
- تقارير التشغيلات والمنتهي والقريب من الانتهاء: `GET /inventory/batches[/near-expiry|/expired]` (Phase 5).

**المندوبون** (`reports.representatives`)
- `GET /reports/representatives/performance` (زيارات موثّقة/مشكوك بها، طلبات، مبيعات، مردودات، تحصيل).
- `GET /reports/representatives/target-achievement?date=` (نسب المبيعات والزيارات والطلبات).
- `GET /reports/representatives/missed-visits`.

**لوحات المتابعة**
- `GET /dashboard` (`reports.sales`): مبيعات/صافي/مردودات/تحصيل اليوم والشهر، الطلبات والمعلّق منها، الذمم، المندوبون والزيارات، المخزون المنخفض، القريب من الانتهاء والمنتهي، وأفضل العملاء والمنتجات والمندوبين.
- `GET /dashboard/me` (أي مندوب): مبيعاته وتحصيله وزياراته وخطة اليوم، هدف اليوم ونسب التحقق، والعملاء المتأخرون.

**أخرى:** `reorderLevel` للمنتج، إعداد `overdue_days`، فهارس تواريخ للتقارير.

**اختبارات:** `reports-logic.spec.ts` (11 اختباراً: النسب، الهدف اليومي، الأعمار، تصدير CSV وحماية حقن الصيغ). **شغّلت كل ملفات الاختبار النقية من المراحل 1-7 معاً: 88 اختباراً نجحت، 0 فشل.**

## Pending — الأهم
- **استعلامات SQL في التقارير لم تُنفَّذ على PostgreSQL** (لا قاعدة بيانات ولا شبكة هنا)؛ أخطاء الصياغة أو أسماء الأعمدة أو المنطقة الزمنية محتملة. اختبر كل تقرير مرة على بيانات حقيقية وقارن أرقامه يدوياً:
  1. مجموع `sales/daily` لشهر = مجموع `sales/by/customer` لنفس الشهر (صافي الفواتير) = `dashboard.sales.month`.
  2. مجموع `financial/receivables.receivable` = `dashboard.receivables.total`.
  3. مجموع `financial/aging.total` = مجموع `outstanding-invoices.remaining`.
  4. `inventory/movement`: `closing` = الكمية في `inventory/current`.
- تصدير **Excel (.xlsx)** و**PDF** وتنزيل الملفات الكبيرة برابط مؤقت (SRS §89)؛ الحالي CSV مباشر بحد 50,000 صف.
- الطباعة (فواتير، كشوفات، سند قبض).
- ربط الأداء بالزمن الفعلي (Cache أو جداول تجميعية) إن ثبت بطء الاستعلامات مع كبر البيانات.
- لوحات الواجهة (الرسوم والجداول) — الـ API فقط جاهز.
- الإشعارات (انتهاء الصلاحية، المتأخرات، الأهداف) — SRS §44.

## تشغيل
```bash
cd apps/api
npx prisma migrate dev --name phase7_reports
npm run db:deploy && npm run db:seed && npm test
```

## Next: Phase 8 — Sync & Offline API
Idempotency وSync Queue وConflict Queue وAPI المزامنة للموبايل (Delta Sync، دفعات، حل التعارض).

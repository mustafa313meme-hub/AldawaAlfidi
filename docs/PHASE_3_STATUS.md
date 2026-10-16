# Phase 3 — Customers & Field Force: Status

## Completed (مكتوب في الكود)
- **Representatives** `/representatives`: CRUD بلا حذف، كود تلقائي `R-0001`، ربط بمستخدم ومشرف، الحالات (Active/Suspended/Vacation/Inactive)، `POST :id/transfer-customers` لنقل عملاء مندوب (أو منطقة بعينها) إلى آخر مع حفظ التاريخ.
- **Areas** `/areas`: CRUD بلا حذف، إسناد/نقل/إلغاء إسناد المنطقة، خيار نقل عملاء المنطقة مع نقلها، سجل تاريخ المناطق، ومعرفة المندوب المسؤول عن كل منطقة.
- **Customers** `/customers`: كود تلقائي `C-000001`، 6 أنواع، بحث عربي جزئي، فلترة (نوع/حالة/منطقة/مندوب/مدينة)، إسناد وتاريخ الإسناد، **خريطة** `GET /customers/map` مع بحث بالشعاع مرتّب بالمسافة، قائمة أسعار للعميل (المؤجَّلة من Phase 2).
- **Visits** `/visits`: تسجيل بالموقع (lat/lng/accuracy/وقت القراءة)، تقييم الموقع، منع الزيارات الوهمية اختيارياً، تكرار Offline آمن (`x-device-id` + `localId`)، مندوب لا يسجل إلا لعملائه ولنفسه، تعديل خلال 24 ساعة.
- **Visit Plans** `/visit-plans`: خطة اليوم مرتّبة مع آخر زيارة، استبدال الخطة المفتوحة مع الإبقاء على المنجَز، إنجاز تلقائي عند تسجيل الزيارة، المندوب يستطيع «تخطّي» فقط.
- **Sales Targets** `/sales-targets`: إدخال وتعديل (المندوب يرى أهدافه فقط).
- **نطاق الصفوف** (`ScopeService`) + صلاحيات جديدة: `customers.view_all/assign/manage_credit`, `areas.assign`, `visits.view_all`, `visit_plans.*`, `targets.*` (73 صلاحية إجمالاً).
- **قيود DB:** صف مفتوح واحد لكل منطقة/عميل أساسي، صحة الإحداثيات، `endTime >= startTime`، أهداف غير سالبة.
- **اختبارات:** `geo.spec` و`visit-location.spec` (شغّلتها هنا بمشغّل مبسّط: 9/9)، وفحص أن كل صلاحيات الأدوار معرّفة ولا يوجد تكرار، وأن المندوب بلا `view_all` ولا `view_cost`.

## Pending
- **لم يُشغَّل المشروع بعد:** لا `npm install` ولا `prisma generate/migrate` ولا build ولا Jest (بيئتي بلا شبكة). Phase 1-3 كلها غير مُتحقَّق منها بالتشغيل.
- أخطاء TypeScript المتبقية في فحصي المبدئي ناتجة عن غياب Prisma Client وحزم Nest فقط؛ الأخطاء الحقيقية قد تظهر بعد `prisma generate`.
- اختبارات تكامل لنطاق الصفوف (مندوب لا يرى عميل مندوب آخر؛ 404) ولتزامن الإسناد.
- ربط المندوب بالمنطقة في **قائمة العملاء** غير مُفعَّل (الرؤية بالإسناد فقط).
- Route Planning وGeofencing (مؤجَّلان في SRS §14).
- نسبة إنجاز الهدف (Phase 4/7)، رصيد العميل وآخر طلب في خطة اليوم (Phase 4-6).

## تشغيل
```bash
cd apps/api
npx prisma migrate dev --name phase3_field_force
npm run db:deploy && npm run db:seed && npm test
```

## نقاط API الجديدة — `/api/v1`
`representatives` · `areas` · `customers` (+`map`, `assign`, `assignments`) · `visits` · `visit-plans` · `sales-targets`

## Next: Phase 4 — Orders, Invoices & Bonus
Sales orders، الفواتير، قواعد البونص، الخصم، الترقيم، ودعم المردود حسب سياسة Proportional.

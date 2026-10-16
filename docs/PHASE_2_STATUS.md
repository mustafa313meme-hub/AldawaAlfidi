# Phase 2 — Master Data: Status

## Completed (مكتوب في الكود)
- **Companies:** قائمة/بحث/تفاصيل/إنشاء/تعديل/تعطيل (`/companies`).
- **Categories:** قائمة مسطحة بـ parentId، حتى 5 مستويات، منع الدورات والأسماء المكررة (`/categories`).
- **Products:** CRUD بلا حذف، رمز تلقائي، باركود فريد، `GET /products/by-barcode/:barcode`، بحث عربي/إنجليزي جزئي، فلترة بالشركة والتصنيف، ترتيب، Pagination، إخفاء التكلفة والأسعار حسب الصلاحية.
- **Price Lists:** إنشاء/تعديل، قائمة افتراضية واحدة، رفع أسعار بالجملة (حتى 1000 صنف)، حذف سعر، و`GET /price-lists/resolve` لحساب السعر الفعّال.
- **Warehouses:** CRUD مع مدير مخزن وكود تلقائي `WH-001`.
- **Sequence:** عدّاد ذري للترقيم بلا تكرار.
- **قيود قاعدة البيانات:** `prisma/sql/constraints.sql` (أسعار غير سالبة، `minSalePrice <= salePrice`، ضريبة 0-100، قائمة افتراضية واحدة).
- **صلاحيات جديدة:** `categories.*` و`price_lists.*` و`products.view_cost` و`products.view_prices` وتوزيعها على الأدوار.
- **Audit:** كل إنشاء/تعديل/تعطيل/تغيير سعر مسجّل بالقيم القديمة والجديدة.
- **اختبارات:** `arabic.spec` و`pricing.spec` و`category-tree.spec` (شغّلتها هنا بمشغّل مبسّط: 10/10 نجحت).

## Pending
- **لم يُشغَّل المشروع بعد** (لا شبكة هنا): `npm install` و`prisma migrate dev` و`npm test` و`npm run build` ما زالت مطلوبة، وPhase 1 نفسها غير مُتحقَّق منها.
- اختبارات تكامل (Authorization: مندوب بلا `view_cost` لا يرى التكلفة؛ سعر أقل من الحد الأدنى يُرفض).
- `CustomerPriceList` (Phase 3).
- فهرس `pg_trgm` لتسريع البحث عند كبر الجدول (Phase 7/9).
- استيراد منتجات من Excel (لم يُطلب في SRS صراحة).

## Known Issues / تنبيهات
- الـ migration الجديدة تُولَّد بـ `npx prisma migrate dev --name phase2_master_data` (بعد `init`).
- بعد كل `migrate`، نفّذ `npm run db:deploy` لتطبيق triggers وconstraints.
- ثم `npm run db:seed` لتحديث الصلاحيات والأدوار الجديدة (يعيد مزامنة أدوار النظام فقط).

## نقاط API الجديدة — `/api/v1`
`companies` · `categories` · `products` (+`by-barcode`) · `price-lists` (+`items`, `resolve`) · `warehouses`

## Next: Phase 3 — Customers & Field Force
Representatives, Areas, Customers, Assignments, Map, Visits.

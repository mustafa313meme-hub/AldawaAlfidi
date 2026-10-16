# Phase 4 — Orders, Invoices, Bonus & Returns: Status

## Completed (مكتوب في الكود)
- **Bonus Rules** `/bonus-rules`: كل N + M، فترة صلاحية، نوع عميل، تفعيل/تعطيل، عدة قواعد للمنتج الواحد.
- **حساب البيع:** سعر من قائمة العميل ← الافتراضية ← المنتج، حد أدنى صارم، خصم نسبة/مبلغ، ضريبة، بونص — كلها في الخادم وبأعداد صحيحة.
- **Orders** `/orders`: إنشاء (مسودة/إرسال) وتعديل ومعاينة السعر والبونص `POST /orders/preview`، دورة الحالات (Draft→Submitted→Approved→Preparing→Delivered/Cancelled)، **تحويل إلى فاتورة** `POST :id/convert-to-invoice`، idempotent للموبايل، ونطاق رؤية المندوب.
- **Invoices** `/invoices`: إنشاء بمعاملة واحدة (تحقق العميل والمخزون ← حساب ← فاتورة وسطور ← خصم مخزون ← حركات ← قيد حساب ← Audit)، حد ائتماني، **إلغاء** بقيد عكسي.
- **Returns** `/returns`: سياسة **Proportional** (وIndependent وFullBonusOnReturn)، إرجاع بونص مستقل، منع تجاوز القابل للإرجاع، قيمة بعد الخصم بتقريب دقيق، مخزون حسب الحالة (سليم/تالف/منتهي)، محاسبة البونص الزائد بدل إرجاعه بصلاحية الاعتماد.
- **Stock (حدّ أدنى):** `GET /stock`, `GET /stock/movements`, `POST /stock/opening`.
- **Ledger:** `GET /customers/:id/balance` و`/statement` (رصيد افتتاحي + حركات مع رصيد جارٍ).
- **قيود DB:** مخزون غير سالب، `returnedQuantity <= quantity`، `bonusReturnedQuantity <= bonusQuantity`، اتساق مبالغ السطر، triggers Append-only للحركات والقيود.
- **صلاحيات:** `invoices.edit_price/discount/override_credit`، `ledger.view`، `bonus_rules.*` (79 صلاحية). المندوب بلا خصم ولا تعديل سعر ولا إلغاء فاتورة ولا تجاوز ائتمان.
- **اختبارات:** `sales-logic.spec.ts` — **28 اختباراً نجحت كلها** (شغّلتها هنا): مثال SRS §58 (90,000)، التقريب، التقسيط التراكمي، البونص المتعدد، سياسة Proportional بكل حالاتها، الحدود القصوى للإرجاع.

## Pending (لم يُنفَّذ أو لم يُتحقَّق منه)
- **لم يُشغَّل المشروع كله** (لا شبكة هنا): الجزء الذي لم أختبره هو الأخطر — المعاملات، الأقفال، الاستعلامات الخام، تفاعل Prisma مع القيود. يجب اختبار تكاملي على PostgreSQL حقيقي قبل أي استخدام مالي:
  - بيعان متزامنان لآخر وحدة مخزون (أحدهما يفشل).
  - مردودان متزامنان لنفس السطر.
  - فاتورة تفشل في منتصفها (تأكد من Rollback كامل).
  - مطابقة `Stock.quantity` مع مجموع `StockMovements`، ورصيد العميل مع `LedgerEntries`.
- المشتريات والتحويل والتسوية والتشغيلات وانتهاء الصلاحية وFEFO (Phase 5).
- التسديدات وربطها بالفواتير (Phase 6).
- الطباعة، ومرتجع المشتريات، وفاتورة Draft.
- `TaxSettings` (ADR-056).
- مطابقة آلية (Reconciliation job) تتحقق من سلامة المخزون والأرصدة.

## تشغيل
```bash
cd apps/api
npx prisma migrate dev --name phase4_sales_core
npm run db:deploy && npm run db:seed && npm test
```

## نقاط API الجديدة — `/api/v1`
`bonus-rules` · `orders` (+`preview`, `submit`, `approve`, `prepare`, `cancel`, `convert-to-invoice`) · `invoices` (+`cancel`) · `returns` · `stock` (+`opening`, `movements`) · `customers/:id/balance` · `customers/:id/statement`

## Next: Phase 5 — Inventory
المشتريات، التحويل بين المخازن، التسوية والجرد، التشغيلات وانتهاء الصلاحية (FEFO).

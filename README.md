# مكتب الدواء الفضي العلمي — Silver Pharma Scientific Office

ERP + إدارة المندوبين الميدانيين. المواصفات في `docs/` (ADR، ERD، سياسة المردود والبونص).

```
apps/api      NestJS + Prisma + PostgreSQL   (Phase 1-10 ✔ مكتوب، لم يُشغَّل بعد — شغّل scripts/acceptance-test.mjs)
apps/admin    واجهة الإدارة (HTML/JS عادي، بلا بناء) — مبنية ومُختبَرة على خادم تجريبي
apps/rep      تطبيق المندوب (PWA يعمل دون إنترنت، HTML/JS بلا بناء) — مبني ومُختبَر على خادم تجريبي
apps/mobile   (استُبدل بـ apps/rep؛ Flutter اختياري لاحقاً)
docs/         DECISIONS, ERD, RETURNS_BONUS_POLICY, PHASE_X_STATUS
```

## البدء
انظر قسم "تشغيل أول مرة" في `docs/PHASE_1_STATUS.md`.
مع Docker (بعد توليد migration الأولى): `docker compose up --build` ثم
`docker compose exec api npx ts-node -P prisma/tsconfig.json prisma/seed.ts`
(أو شغّل الـ seed محلياً بعد ضبط `DATABASE_URL`).

## نقاط API (Phase 1) — `/api/v1`
`auth/*` · `users/*` · `roles` · `permissions` · `settings` · `audit-logs` · `health`

Phase 2: `companies` · `categories` · `products` · `price-lists` · `warehouses`

Phase 3: `representatives` · `areas` · `customers` · `visits` · `visit-plans` · `sales-targets`

Phase 4: `bonus-rules` · `orders` · `invoices` · `returns` · `stock` · `customers/:id/balance|statement`

Phase 5: `purchases` · `transfers` · `adjustments` · `inventory/batches` · `inventory/stocktake` · `inventory/reconcile`

Phase 6: `payments` · `customers/:id/open-invoices` · `accounting/reconcile`

Phase 7: `reports/*` (sales, returns, financial, inventory, representatives; `?format=csv`) · `dashboard` · `dashboard/me`

Phase 8: `sync/push` · `sync/pull/:entity` · `sync/conflicts` · `sync/status` · `Idempotency-Key` على الفواتير

Phase 9: `notifications` · `app/version`

Phase 10: `scripts/acceptance-test.mjs` · `.github/workflows/ci.yml` · `docker-compose.prod.yml` · `scripts/backup.sh` · `docs/RUNBOOK.md` · `docs/SECURITY_REVIEW.md` · `docs/PRODUCTION_CHECKLIST.md`

## ⚠️ حالة المشروع
الكود (المراحل 1-10) **لم يُترجَم ولم يُشغَّل بعد**. الخطوة الأولى دائماً: `scripts/acceptance-test.mjs` (أو CI). واجهة الإدارة مبنية (`apps/admin`) ومُختبَرة على خادم تجريبي فقط؛ تطبيق المندوب لم يُبنَ. انظر `docs/PHASE_10_STATUS.md` و`docs/ADMIN_UI_STATUS.md`.

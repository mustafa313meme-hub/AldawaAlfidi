# Phase 1 — Foundation: Status

## Completed (مكتوب في الكود)
- هيكل monorepo: `apps/api` (جاهز)، `apps/admin` و`apps/mobile` (placeholders)، `packages/shared`.
- Docker: `docker-compose.yml` (PostgreSQL 16 + Redis + API) و`Dockerfile` متعدد المراحل، `.env.example`.
- Prisma schema: roles, permissions, role_permissions, user_permissions, users, user_devices, refresh_tokens, password_reset_tokens, audit_logs, settings.
- Auth: login (username/phone/email)، refresh مع Rotation وكشف إعادة الاستخدام، logout (جهاز/كل الأجهزة)، change-password، forgot/reset-password، قفل الحساب بعد 5 محاولات فاشلة، Argon2id، تسجيل الأجهزة، إيقاف جهاز.
- Users: CRUD (Soft Delete)، بحث/فلترة/ترتيب/Pagination، تعيين كلمة مرور من المدير، حماية آخر Super Admin.
- Roles/Permissions: عرض الأدوار والصلاحيات، إنشاء دور، تعديل صلاحيات دور، Overrides لكل مستخدم (Role + UserPermission).
- Audit: AuditService (يدعم نفس معاملة DB) + `GET /audit-logs` للقراءة فقط + triggers تمنع التعديل والحذف.
- Settings: `bonus_return_policy` (= Proportional افتراضياً)، `require_location_for_visit`، `currency`.
- معيار الاستجابة والأخطاء حسب SRS §54، Rate limiting، Helmet، Validation، CORS.
- Seed: كل الصلاحيات + 7 أدوار + الإعدادات + أول Super Admin من متغيرات البيئة.
- اختبارات وحدة: حل الصلاحيات الفعلية، PermissionsGuard، تعريفات الأدوار، sha256.

## Pending (لم يُنفَّذ أو لم يُتحقَّق منه)
- **لم أستطع تشغيل المشروع هنا** (لا شبكة لتثبيت الحزم). تحققت فقط من منطق الصلاحيات وsha256 بتشغيل مباشر. `npm install` و`prisma migrate dev --name init` و`npm test` و`npm run build` لم تُنفَّذ بعد.
- ملف الـ migration الأولي (يُولَّد عند أول `prisma migrate dev`).
- اختبارات تكامل/E2E (Auth flow، التحقق من أن المندوب لا يصل لبيانات مندوب آخر — ينتظر Phase 3 لوجود البيانات).
- واجهة Admin وتطبيق Mobile.
- قناة إرسال رمز استعادة كلمة المرور (SMS/Email) — حالياً Stub يطبع الرمز في وضع development فقط.
- Backup وRestore (Phase 10).

## Known Issues / تنبيهات
- قد يظهر بعض أخطاء TypeScript عند أول build (لم يُترجَم الكود بعد)؛ أرسلها لي وأصلحها.
- `JWT_REFRESH_SECRET` غير مستخدم حالياً (ADR-021).
- اسم المستخدم بعد الحذف الناعم يبقى محجوزاً (unique).

## Tests
- `npm test` ← `src/common/permissions.spec.ts` (لم يُشغَّل بـ Jest بعد).

## تشغيل أول مرة
```bash
cp .env.example .env        # املأ JWT_SECRET و JWT_REFRESH_SECRET و SEED_ADMIN_PASSWORD
cd apps/api && npm install
npx prisma migrate dev --name init
npm run db:deploy && npm run db:seed
npm test && npm run start:dev
```

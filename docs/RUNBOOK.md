# RUNBOOK — النشر والنسخ الاحتياطي والاستعادة

> هذا الدليل **لم يُجرَّب على خادم حقيقي** (لا شبكة ولا Docker في بيئة الكتابة). جرّب كل خطوة على بيئة تجريبية أولاً.

## 1. أول نشر
```bash
# على خادم Linux عليه Docker، ونطاق يشير إلى عنوانه (DNS A record)
git clone <repo> && cd silver-pharma-erp
cp .env.example .env.production           # املأ كل القيم؛ لا تُدخله في Git أبداً
#  - JWT_SECRET و JWT_REFRESH_SECRET:  openssl rand -base64 48   (مختلفان، 32 حرفاً فأكثر)
#  - POSTGRES_PASSWORD و APP_DB_PASSWORD: كلمتا سر طويلتان مختلفتان
#  - SEED_ADMIN_PASSWORD: 12 حرفاً فأكثر (يُطلب تغييرها عند أول دخول)
#  - CORS_ORIGINS: عنوان لوحة الإدارة فقط

C="docker compose -f docker-compose.prod.yml --env-file .env.production"
$C up -d db
$C --profile tools run --rm migrate                  # الجداول + triggers + القيود (بدور المالك)
$C exec -T db psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -v app_password="'$APP_DB_PASSWORD'" -v dbname="$POSTGRES_DB" < deploy/db-roles.sql
$C run --rm -e DATABASE_URL="postgresql://$POSTGRES_USER:$POSTGRES_PASSWORD@db:5432/$POSTGRES_DB?schema=public" api npm run db:seed   # الأدوار والصلاحيات وأول Super Admin
$C up -d --build
curl -fsS https://$DOMAIN/api/v1/health
```
ثم **قبل أي استخدام**: شغّل `node scripts/acceptance-test.mjs` على **نسخة تجريبية** (لا على بيانات حقيقية؛ يُنشئ بيانات ولا يحذفها).

## 2. التحديث
```bash
git pull
$C --profile tools run --rm migrate      # أولاً (إن كان في الإصدار migration)
$C up -d --build api
```
- خذ نسخة احتياطية قبل أي تحديث فيه migration: `./scripts/backup.sh`.
- بعد كل migration فيه جدول جديد «للقراءة والإضافة فقط»، أعد `REVOKE` في `deploy/db-roles.sql` له.

## 3. النسخ الاحتياطي
| البند | التوصية (تحتاج موافقتك) |
|---|---|
| ماذا | قاعدة PostgreSQL كاملة (`pg_dump --format=custom`) + فحص قراءة الأرشيف + checksum |
| متى | يومياً 02:00 بتوقيت بغداد، وقبل كل تحديث |
| أين | (1) قرص مستقل على الخادم `BACKUP_DIR` (2) **نسخة خارج الخادم** عبر `OFFSITE_CMD` (rclone إلى تخزين سحابي/خادم آخر). نسخة على نفس القرص ليست نسخة احتياطية |
| الاحتفاظ | 14 يوماً يومية، 8 أسابيع أسبوعية (الأحد)، 12 شهراً شهرية (أول الشهر) |
| التشفير | `BACKUP_GPG_RECIPIENT`؛ المفتاح الخاص يُحفظ خارج الخادم |
| **RPO** | **24 ساعة** مع النسخ اليومية (أقصى بيانات قد تضيع). لتقليله إلى دقائق: فعّل WAL archiving/PITR (غير مبني هنا) |
| **RTO** | **هدف 2 ساعة** (استعادة + فحص). **القياس الفعلي** يخرج من `verify-backup.sh` (يطبع زمن الاستعادة) |

جدولة (cron على الخادم):
```cron
0 23 * * *  cd /opt/silver-pharma-erp && DATABASE_URL='postgresql://owner:...@localhost:5432/silverpharma' BACKUP_DIR=/var/backups/silverpharma BACKUP_GPG_RECIPIENT=ops@example.com OFFSITE_CMD='rclone copy "$BACKUP_FILE" remote:silverpharma/' ./scripts/backup.sh >> /var/log/silverpharma-backup.log 2>&1
```
(23:00 UTC = 02:00 بغداد). مع Docker: `docker compose exec -T db pg_dump -U $POSTGRES_USER -Fc $POSTGRES_DB > backup.dump`.

## 4. الاستعادة
```bash
# 1) أوقف الـ API
$C stop api
# 2) (إن كان الملف مشفراً) gpg --decrypt backup.dump.gpg > backup.dump
# 3) استعد
TARGET_DATABASE_URL='postgresql://owner:...@localhost:5432/silverpharma' ./scripts/restore.sh backup.dump --yes-i-am-sure
# 4) تحقق من السلامة
psql "$TARGET_DATABASE_URL" -v ON_ERROR_STOP=1 -f scripts/verify-restore.sql
# 5) شغّل وتحقق
$C up -d api
curl -H "Authorization: Bearer <admin token>" https://$DOMAIN/api/v1/inventory/reconcile     # ok: true
curl -H "Authorization: Bearer <admin token>" https://$DOMAIN/api/v1/accounting/reconcile    # ok: true
```
**تمرين الاستعادة شهرياً:** `./scripts/verify-backup.sh backups/daily/<latest>.dump` ويسجَّل الزمن الذي يطبعه.

## 5. المراقبة اليومية
- `GET /api/v1/health` (الـ compose يفحصه كل 15 ثانية).
- `GET /api/v1/inventory/reconcile` و`/accounting/reconcile` يومياً (أو بعد كل نشر): إن رجع `ok: false` **لا تتجاهله** — هناك خلل في دفاتر المال أو المخزون.
- `docker compose logs api --since 24h | grep -i -E "error|STOCK_INCONSISTENT|ALLOCATION_MISMATCH"`.
- طابور المزامنة: `GET /api/v1/sync/conflicts` (عمليات المندوبين التي تنتظر قراراً).
- فعّل `NOTIFICATIONS_JOB=true` لتنبيهات الصلاحية والمخزون والمتأخرات.

## 6. حوادث
| الحالة | التصرف |
|---|---|
| `reconcile` يرجع مشاكل | أوقف الإدخال (أوقف الـ API)، خذ نسخة احتياطية فوراً قبل أي إصلاح، ثم حدّد أول عملية خاطئة من `stock_movements`/`ledger_entries`/`audit_logs`. التصحيح **بقيود عكسية/تسويات** وليس بتعديل الصفوف (ممنوع بالـ triggers) |
| حساب مندوب مخترق/جهاز ضائع | `POST /users/:id/devices/:deviceId/revoke` (يُنهي الجلسات ويمنع الدخول) ثم `POST /users/:id/reset-password` |
| تسريب سر | بدّل `JWT_SECRET`/`JWT_REFRESH_SECRET` (يُنهي كل الجلسات)، وبدّل كلمات سر قاعدة البيانات |
| الخادم لا يقلع بعد تحديث | ارجع للإصدار السابق (`git checkout <tag>` + `up -d --build api`)؛ إن كان في الإصدار migration فاستعد النسخة التي أخذتها قبله |

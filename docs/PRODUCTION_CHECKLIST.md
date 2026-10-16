# PRODUCTION CHECKLIST (SRS §109)

الحالة: ✅ مكتوب في المستودع (غير مُجرَّب) · 🟡 جزئي · ⬜ مطلوب منك/لم يُبنَ · ➖ لا ينطبق بعد (لا يوجد تطبيق موبايل)

| البند | الحالة | ملاحظة |
|---|---|---|
| HTTPS | ✅ | Caddy يصدر الشهادة تلقائياً (`deploy/Caddyfile`)؛ يحتاج نطاقاً ومنفذي 80/443 |
| Environment variables | ✅ | `.env.example`؛ الإقلاع يفشل عند نقص الأسرار |
| Database migrations | 🟡 | `prisma migrate dev --name init` **لم يُولَّد بعد** (لا شبكة)؛ ولّده وأدخل مجلد `prisma/migrations` في Git |
| Backup | ✅ | `scripts/backup.sh` (يومي/أسبوعي/شهري + تشفير + نسخ خارجي) |
| Restore test | ✅/⬜ | `scripts/verify-backup.sh` جاهز؛ **تنفيذ التمرين عليك** وتسجيل الزمن |
| Admin account secured | 🟡 | كلمة سر من البيئة + تغيير إلزامي عند أول دخول + قفل المحاولات؛ **2FA غير مبني** |
| Password hashing | ✅ | Argon2id |
| Rate limiting | ✅ | Throttler |
| CORS | ✅ | قائمة بيضاء |
| Logs | 🟡 | سجلات Nest + Audit في DB؛ لا تجميع مركزي |
| Admin Dashboard (SRS §117) | 🟡 | **مبنية ومُختبَرة على خادم تجريبي** (`docs/ADMIN_UI_STATUS.md`)؛ لم تُجرَّب على الـ API الحقيقي، وتنقصها زيارات/أهداف/جرد/خريطة |
| Mobile App (SRS §117) | ⬜ | **لم تُبنَ** |
| Monitoring | ⬜ | health check فقط |
| Error tracking | ⬜ | Sentry غير مربوط |
| API docs | ⬜ | لا Swagger/OpenAPI؛ المسارات في `docs/PHASE_X_STATUS.md` و`README.md` |
| Mobile signing | ➖ | لا تطبيق |
| App icons | ➖ | لا تطبيق |
| Splash screen | ➖ | لا تطبيق |
| Privacy policy | ⬜ | نص قانوني منك |
| Terms | ⬜ | نص قانوني منك |
| Store metadata | ➖ | لا تطبيق |

## معايير القبول (SRS §116)
`node scripts/acceptance-test.mjs` يغطي المعايير **1 إلى 28** + 10 فحوص سلامة وتزامن. النتيجة المقبولة: كل الفحوص PASS و`reconcile` = `ok: true`.
CI (`.github/workflows/ci.yml`) يشغّله تلقائياً على كل push إن رفعت المشروع إلى GitHub.

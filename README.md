# SVU LREC Engine — Coolify

محرك خادمي مستقل لتحويل محاضرات Linktivity LREC إلى MP4، باستخدام Node.js 22 وFFmpeg داخل Docker. يظل الموقع الأساسي `https://svu.hussamm.tech` وقاعدة بيانات المشتركين على cPanel كما هما.

**حالة المشروع:** المستودع جرى إنشاؤه؛ حزمة المصدر v0.1.0 جهّزت واختُبرت محلياً، لكنها لم تُرفع كاملة إلى GitHub بعد. لا توجد Docker Image منشورة حتى يتم رفع المصدر ونجاح GitHub Actions.

## أول رفع للمشروع

1. نزّل ملف `SVU-LREC-Coolify-Engine-v0.1.0.zip` المرفق في محادثة ChatGPT.
2. فك ضغطه محلياً، وادخل إلى مجلد `svu-cloud-engine` (أو افتح ملفات محتويات الحزمة الجديدة مباشرة).
3. من صفحة هذا المستودع على GitHub اختر **Add file → Upload files** وارفع **محتويات** المشروع وليس ملف ZIP؛ ارفع ملفات `src/` و`.github/workflows/` و`tests/` و`Dockerfile` و`package.json` و`.dockerignore` و`DEPLOY_NOTES_AR.md`. اترك README الحالي إن رفض GitHub استبداله.
4. بعد Commit، افتح **Actions → Build and publish Docker image** وتحقق من ظهور تشغيل أخضر.
5. عند نجاحه، استخدم Docker Image في Coolify: `ghcr.io/hussamalbarouki/svu-lrec-engine:main`، المنفذ `3000`.

## Coolify / DNS

- Domain: `https://engine.svu.hussamm.tech`
- Cloudflare A record: `engine.svu` → VPS IP مع **DNS only**.
- Environment: `ENGINE_SHARED_SECRET` (سري عشوائي 32+ حرفاً)، `APP_ORIGIN=https://svu.hussamm.tech`.
- اختبار الصحة: `https://engine.svu.hussamm.tech/healthz`.

**مهم:** الربط بواجهة PHP ونظام الحصص لم يُنفذ بعد. لا تفعل محرك VPS للمستخدمين إلا بعد إنشاء باتش منفصل للموقع الأساسي وتحقق كامل من تحويل محاضرة فعلية على VPS. ملفات LREC لا تخزن على cPanel إطلاقاً؛ المعالجة والملفات المؤقتة تقع حصرياً على VPS.

عند استبدال VPS: ثبّت Coolify من جديد، أضف Docker Image نفسها واضبط البيئة، ثم غيّر DNS A record بعد التأكد من جاهزية المحرك.

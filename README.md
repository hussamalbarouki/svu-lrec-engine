# SVU LREC Engine — Coolify

محرك تحويل محاضرات LREC إلى MP4 عبر Docker وFFmpeg، مخصص لموقع `https://svu.hussamm.tech`.

## حالة المشروع
تم تجهيز مستودع GitHub وWorkflow لبناء Docker ونشر الصورة تلقائياً. **كود المحرك الكامل لم يُرفع إلى المستودع بعد**، والصورة ليست منشورة حتى نجاح بناء GitHub Actions.

## رفع المصدر من ملف واحد
1. حمّل الحزمة `SVU-LREC-Coolify-Engine-v0.1.0.zip` من محادثة ChatGPT.
2. افتح المستودع على GitHub ثم **Add file → Upload files**.
3. ارفع **ملف ZIP نفسه**، دون فك ضغطه، بنفس الاسم تماماً في جذر المستودع.
4. اضغط **Commit changes**. سيبدأ `Build and publish SVU LREC Engine` تلقائياً.
5. افتح تبويب Actions وتأكد من نجاح البناء. الصورة المنتظرة `ghcr.io/hussamalbarouki/svu-lrec-engine:main`.

بعد نجاح البناء:
- Coolify → Project → New Resource → Docker Image
- Image: `ghcr.io/hussamalbarouki/svu-lrec-engine:main`
- Port: `3000`
- Domain: `https://engine.svu.hussamm.tech`
- Cloudflare DNS: سجل A باسم `engine.svu`، عنوان VPS، DNS only
- Variables: `APP_ORIGIN=https://svu.hussamm.tech` و `ENGINE_SHARED_SECRET` بقيمة عشوائية لا تقل عن 32 حرفاً
- المسار الصحي `/healthz`.

**تنبيه:** الربط بلوحة cPanel ونظام الاشتراكات يحتاج باتشاً منفصلاً. لا تغيّر محرك الموقع الرئيسي قبل تطبيقه واختبار التحويل الحقيقي. ملفات LREC وMP4 لا تُخزن على cPanel.

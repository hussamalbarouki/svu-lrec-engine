# خطوات تشغيل محرك SVU داخل Coolify

1. انتظر نجاح GitHub Actions حتى تظهر الصورة `ghcr.io/hussamalbarouki/svu-lrec-engine:main` في Packages.
2. Coolify ← Project ← Production ← New Resource ← Docker Image.
3. ضع الصورة مع tag `main`، والمنفذ الداخلي **3000**.
4. ضع بيئة `ENGINE_SHARED_SECRET` بقيمة عشوائية سرية طويلة (أكثر من 32 حرفاً)، و`APP_ORIGIN=https://svu.hussamm.tech`. لا تنشر المفتاح في المحادثات أو في المتصفح.
5. في Cloudflare DNS أنشئ سجل A باسم `engine.svu` يشير إلى IP الـ VPS الجديد، وخيار البروكسي **DNS only**. لا تغيّر `svu.hussamm.tech`.
6. داخل Coolify ضع دومين `https://engine.svu.hussamm.tech` واضغط Deploy؛ تحقّق من `/healthz`.
7. لا تفعل وضع VPS للزوار بعد؛ هذه حزمة المحرك فقط. نحتاج باتش مستقل لموقع PHP لتوليد HMAC tokens والتحكم بالمحرك وخصم الرصيد بناءً على النتيجة.

### عند تغيير VPS
- ثبّت Coolify الجديد → أضف نفس Docker Image → ضع البيئة والدومين → عدّل IP في سجل A → Deploy → اختبر الصحة والتحويل → بدّل وضع الموقع.
- لا يوجد تخزين للمحاضرات على cPanel؛ ملف LREC يذهب مباشرة من متصفح المستخدم إلى VPS، والناتج يُسترجع منه. ملفات الـ VPS مؤقتة وتختفي عند حذفه.

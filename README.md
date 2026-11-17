# LG Stream

مشغّل لقنوات البث والأفلام والمسلسلات على تلفزيونات LG بنظام webOS. يركز على سرعة التنقل بالريموت، وثبات التشغيل، والحفاظ على جودة الصورة والصوت التي يدعمها التلفزيون ومسار الصوت المتصل به.

A player for live TV, movies and series on LG webOS televisions. It focuses on responsive remote navigation, reliable playback, and the picture and audio formats supported by the television and connected audio equipment.

## واجهة التطبيق / Interface

لقطات من واجهة التطبيق بأسماء قنوات ومجموعات فرضية، ومنطقة الفيديو تعرض شعار التطبيق للمعاينة.

Screenshots use fictional group and channel names. The video area displays the app logo as a preview.

العربية / Arabic

![واجهة LG Stream بالعربية](docs/images/lg-stream-ar.png)

English / الإنجليزية

![LG Stream English interface](docs/images/lg-stream-en.png)

## المزايا بالعربية

- إضافة قائمة M3U من إعدادات المصادر، وحفظ آخر قائمة ناجحة وإعداداتها محليًا على التلفزيون.
- تصفح القنوات والأفلام والمسلسلات، والبحث في المحتوى، وإدارة المفضلة وإخفاء المجموعات.
- واجهة عربية وإنجليزية. تُختصر الأسماء العربية وتُنظّم المجموعات المتشابهة مع الحفاظ على اختصارات العلامات، وتظهر أسماء المزود الأصلية في القوائم الإنجليزية.
- تصفية القنوات حسب النوع، مثل الرياضة والأفلام والأخبار والأطفال، وترقيم القائمة المعروضة من 1 داخل كل مجموعة أو فلتر.
- عرض جودة الفيديو الفعلية المقاسة من أبعاده، في مساحة منفصلة عن اسم القناة.
- تبديل ملاءمة الصورة مباشرة، وبطاقة قناة ثابتة أعلى اليمين لمدة 6 ثوانٍ عند التبديل.
- التحكم بالتشغيل ومسارات الصوت والترجمة وفق ما يتيحه المصدر والتلفزيون.

يصل التلفزيون إلى مصدر البث مباشرة أثناء المشاهدة. يضيف المستخدم مصادره من داخل التطبيق، ويُحفظ الكتالوج وإعداداته على الجهاز.

## Features in English

- Add an M3U playlist and keep the last successfully loaded catalogue and its settings locally on the TV.
- Browse live channels, movies and series, search content, manage favorites, and hide groups.
- Switch between Arabic and English. Arabic labels are shortened and organized while preserving brand abbreviations. English catalogue rows show the provider's original names.
- Filter channels by categories such as sports, movies, news and kids. Each displayed group or filtered list starts numbering at 1.
- View actual video quality measured from decoded dimensions, separately from the channel name.
- Cycle picture fit directly and see a six-second channel announcement fixed at the top right.
- Use playback controls and select audio or subtitle tracks when available through the source and TV.

Playback connects directly from the TV to the source. Users add their own sources in the app, and the catalogue and settings stay on the device.

## الحالة الحالية / Current status

الإصدار الحالي [0.8.10](https://github.com/amjadoh/lg-stream/releases/tag/v0.8.10)، وهو مثبت ومجرب على LG OLED55CS6LA. دُمجت تحديثاته في الفرع الرئيسي عبر [طلب المراجعة 8](https://github.com/amjadoh/lg-stream/pull/8). يستمر تطوير التطبيق بناءً على نتائج الاستخدام الفعلي.

اجتازت هذه النسخة اختبارات المنطق والواجهة، وفحوصًا قصيرة على التلفزيون. تأكد أثر تكبير الصورة بالمشاهدة، وثبات موضع بطاقة القناة بالقياس. تستمر متابعة حالات الانقطاع المتقطع، وتُسجل نتائج الصوت وصيغ العرض بحسب التجربة الفعلية لكل مصدر وجهاز.

The current release is [0.8.10](https://github.com/amjadoh/lg-stream/releases/tag/v0.8.10), installed and tested on LG OLED55CS6LA. Its updates were merged into main through [pull request 8](https://github.com/amjadoh/lg-stream/pull/8). Development continues from real usage feedback.

This version passed logic and UI checks and short tests on the TV. Visible picture enlargement was confirmed by the user, and the announcement position was measured. Intermittent source interruptions remain under investigation. Audio and display-format support is recorded from tests with each source and device.

## التثبيت والتوثيق / Installation and documentation

تُبنى حزمة IPK عبر GitHub Actions، وتُثبت على التلفزيون باستخدام Developer Mode. تحتاج جلسة Developer Mode إلى التجديد حسب إعدادات LG.

The IPK package is built through GitHub Actions and installed on the TV using Developer Mode. Renew the Developer Mode session according to LG's settings.

- [قدرات الجهاز وحدود الصيغ / Device capabilities and media formats](docs/DEVICE_CAPABILITIES.md)
- [التسليم ونتائج التحقق / Handoff and verification](docs/HANDOFF.md)
- [نقطة الاستكمال / Continuation guide](docs/NEXT_SESSION.md)

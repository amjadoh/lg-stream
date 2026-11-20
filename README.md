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

- شاشة «مصادر البث»: إضافة رابط M3U أو حساب Xtream، وتسمية المصدر وإيقافه وحذفه، وتحديث يدوي أو تلقائي كل 24 ساعة بشريط تقدم دون تجميد الريموت. تُحفظ القائمة وإعداداتها محليًا على التلفزيون.
- القنوات والمجموعات الجديدة من المزود تظهر أولًا، مع مجموعة «جديد».
- الزر الأزرق على أي قناة أو مجموعة: تحديد متعدد، نقل، إعادة تسمية، إخفاء، مع تأكيد قبل الحفظ. ومن الإعدادات «إدارة القنوات والمجموعات» لترتيبها وإظهار المخفي وإعادة الضبط. ترتيب واحد ينعكس على كل العروض والترقيم.
- تصفح القنوات والأفلام والمسلسلات، والبحث في المحتوى، وإدارة المفضلة وإخفاء المجموعات.
- واجهة عربية وإنجليزية. تُختصر الأسماء العربية وتُنظّم المجموعات المتشابهة مع الحفاظ على اختصارات العلامات، وتظهر أسماء المزود الأصلية في القوائم الإنجليزية.
- تصفية القنوات حسب النوع، مثل الرياضة والأفلام والأخبار والأطفال، وترقيم القائمة المعروضة من 1 داخل كل مجموعة أو فلتر.
- عرض جودة الفيديو الفعلية المقاسة من أبعاده، في مساحة منفصلة عن اسم القناة.
- تبديل ملاءمة الصورة مباشرة، وبطاقة قناة ثابتة أعلى اليمين لمدة 6 ثوانٍ عند التبديل.
- التحكم بالتشغيل ومسارات الصوت والترجمة وفق ما يتيحه المصدر والتلفزيون.

يصل التلفزيون إلى مصدر البث مباشرة أثناء المشاهدة. يضيف المستخدم مصادره من داخل التطبيق، ويُحفظ الكتالوج وإعداداته على الجهاز.

## Features in English

- A Streaming sources screen: add an M3U link or an Xtream account, name, pause or delete the source, and refresh manually or automatically every 24 hours with a progress bar while the remote stays responsive. The catalogue and its settings stay locally on the TV.
- New channels and groups from the provider appear first, with a "New" group.
- The blue button on any channel or group: multi-select, move, rename and hide, with a confirmation before saving. Settings → "Manage channels and groups" arranges them, shows hidden items and resets. One order drives every view and the numbering.
- Browse live channels, movies and series, search content, manage favorites, and hide groups.
- Switch between Arabic and English. Arabic labels are shortened and organized while preserving brand abbreviations. English catalogue rows show the provider's original names.
- Filter channels by categories such as sports, movies, news and kids. Each displayed group or filtered list starts numbering at 1.
- View actual video quality measured from decoded dimensions, separately from the channel name.
- Cycle picture fit directly and see a six-second channel announcement fixed at the top right.
- Use playback controls and select audio or subtitle tracks when available through the source and TV.

Playback connects directly from the TV to the source. Users add their own sources in the app, and the catalogue and settings stay on the device.

## الحالة الحالية / Current status

الإصدار الحالي [0.9.0](https://github.com/amjadoh/lg-stream/releases/tag/v0.9.0)، مثبت على LG OLED55CS6LA، ودُمج في الفرع الرئيسي عبر [طلب المراجعة 10](https://github.com/amjadoh/lg-stream/pull/10). يضيف شاشة مصادر البث (M3U وXtream)، وتحديثًا لا يجمّد الريموت مع شريط تقدم، وظهور الجديد أولًا، وتخصيص القنوات والمجموعات بالزر الأزرق مع تأكيد الحفظ. الإصدار 0.9.1 يسرّع التنقل بين صفحات الأفلام ويضيف ترتيب «الأحدث» وسنة الإنتاج من العنوان. الإصدار 0.9.2 يضيف تفاصيل الفيلم من المزود، وتقييم IMDb (مفتاح OMDb) وتقييم TMDB ووصفه بلغة التطبيق (مفتاح TMDB) يكتبهما المالك على التلفزيون، وشارة تقييم على البطاقات، وترتيبًا حسب التقييم، وجلب التقييمات لكل الأفلام في الخلفية، ونافذة تفاصيل أكبر. الإصدار 0.9.3 يفتح الإعلان الرسمي من TMDB مباشرة في تطبيق YouTube، وخدمة خلفية صغيرة تعيدك إلى نفس الفيلم عند الرجوع من الإعلان أو انتهائه أو بقائه موقوفًا دقيقتين.

اجتازت هذه النسخة 45 اختبار منطق وبرامج الواجهة السبعة. على التلفزيون: انخفض أطول حجب للواجهة عند الاستعادة من 8.4 إلى 1.19 ثانية وعند التحديث الكامل من 20.7 إلى 2.4 ثانية، وبقيت القائمة (331841 عنصرًا) سليمة عبر التحديثات، والتبديل بين القنوات 1.25–1.8 ثانية، و30 ثانية تشغيل بلا توقف. تجربة مسار الزر الأزرق كاملًا بالريموت ما زالت عند المالك.

The current release is [0.9.0](https://github.com/amjadoh/lg-stream/releases/tag/v0.9.0), installed on LG OLED55CS6LA and merged into main through [pull request 10](https://github.com/amjadoh/lg-stream/pull/10). It adds a streaming sources screen (M3U and Xtream), a refresh that keeps the remote responsive with a progress bar, new items first, and blue-key channel and group customization with a save confirmation. Version 0.9.1 makes moving through movie pages faster and adds a Newest sort and release years read from titles. Version 0.9.2 adds provider movie details, IMDb ratings (OMDb key) and TMDB ratings and descriptions in the app language (TMDB key), both typed by the owner on the TV, rating badges on cards, a rating sort, background rating fetch for all movies, and a larger details window. Version 0.9.3 opens the official TMDB trailer directly in the YouTube app, and a small background service brings you back to the same movie when you leave the trailer, it ends, or it stays paused for two minutes.

This version passed 45 logic tests and all seven UI programs. On the TV the longest UI block fell from 8.4 s to 1.19 s on restore and from 20.7 s to 2.4 s on a full refresh, the 331,841-item catalogue survived every update, channel switches took 1.25–1.8 s, and 30 s of playback ran with no waits. The owner has yet to try the full blue-key flow on the remote.

## التثبيت والتوثيق / Installation and documentation

تُبنى حزمة IPK عبر GitHub Actions، وتُثبت على التلفزيون باستخدام Developer Mode. تحتاج جلسة Developer Mode إلى التجديد حسب إعدادات LG.

The IPK package is built through GitHub Actions and installed on the TV using Developer Mode. Renew the Developer Mode session according to LG's settings.

- [قدرات الجهاز وحدود الصيغ / Device capabilities and media formats](docs/DEVICE_CAPABILITIES.md)
- [التسليم ونتائج التحقق / Handoff and verification](docs/HANDOFF.md)
- [نقطة الاستكمال / Continuation guide](docs/NEXT_SESSION.md)

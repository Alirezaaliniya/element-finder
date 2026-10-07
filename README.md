# Element Finder Studio

A professional **extraction & reconstruction platform** delivered as a Chrome extension: analyze any web page, map its structure to Elementor widgets, refine the result in a visual builder, and export Elementor-ready JSON together with a complete assets package.

> This is not an HTML-to-JSON converter. It is a modular pipeline of dedicated engines with a builder UI, validation, project storage with versioning, and an extensibility seam for AI-assisted mapping.

**[فارسی ↓](#راهنمای-فارسی)**

## Repository layout

```
extension/            The Chrome extension (Manifest V3, ES modules, no build step)
├── manifest.json
├── smoke-test.mjs    Node-runnable tests for the DOM-free engine modules
└── src/
    ├── common/       constants, utils, Logger, EventBus (context-agnostic)
    ├── core/         IR data model + ExtractionPipeline orchestrator
    ├── engines/      the 10 engines (see docs/ARCHITECTURE.md)
    ├── ai/           AiAssistService — pluggable AI provider seam
    ├── content/      content-script bootstrap, pipeline runner, element picker
    ├── background/   service worker (message routing, snapshot hand-off)
    └── ui/           popup + visual builder (tree, preview, inspector, dialogs)
docs/ARCHITECTURE.md  Engine-by-engine architecture reference
tools/elementor-dump/ PHP tools run against a WordPress + Elementor install:
                      dump-controls.php (controls map), make-atomic-fixture.php
tools/e2e/            Puppeteer harnesses: fidelity.mjs (score vs saved data),
                      extension-run.mjs (through the real extension)
elementor-*.json      Real Elementor template export used as format ground truth
```

## Elementor-built pages

On pages built with Elementor the extension does not approximate styles from
computed CSS. It reverses Elementor's generated CSS through a map of every
control in the installed Elementor and Elementor Pro (including third-party
widgets). That recovers the exact saved settings, kit globals, per-element
custom CSS, and atomic (V4) elements with their style classes. The map is
generated from a live install:

```
php -d memory_limit=2G tools/elementor-dump/dump-controls.php C:/path/to/wordpress
```

Regenerate it after updating Elementor or adding widget plugins. See
`docs/ARCHITECTURE.md` → "Elementor-built pages".

## Install (development)

1. Open `chrome://extensions`, enable **Developer mode**.
2. **Load unpacked** → select the `extension/` folder.
3. Pin "Element Finder Studio".

No build tooling is required — the codebase is plain ES modules loaded natively.

## Usage

1. Open any page (great first test: a site built with Elementor — the extractor
   detects `data-element_type` / `data-widget_type` and passes widgets through
   with 100% confidence).
2. Click the extension icon →
   - **Extract full page** — run the pipeline on `<body>`, or
   - **Pick an element** — click any section on the page to extract just it.
3. The **builder** opens automatically:
   - **Structure** panel: expand/collapse, drag & drop to reorder/reparent,
     `Delete` key or 🗑 to remove nodes, double-click to restore.
   - **Preview**: live reconstruction; click elements to select; switch
     desktop / tablet / mobile.
   - **Inspector**: edit text, edit links, replace images, re-map any node to
     another widget (full Free/Pro catalog), inspect per-device Elementor
     settings, see warnings.
   - **✓ Validate**: errors/warnings/suggestions with one-click fixes.
   - **💾 Save / 🏷 Version / 📁 Projects**: local IndexedDB storage, frozen
     versions, restore and structural compare.
4. **⤓ Export** — any combination of:
   - **Elementor Template JSON** (`version: 0.4`; import via Elementor →
     Templates → Saved Templates → Import)
   - **Structure JSON** (lightweight hierarchy for integrations)
   - **Raw Data JSON** (lossless snapshot backup)
   - **HTML Snapshot** (standalone reconstruction document)
   - **Assets Package** (ZIP of images/SVGs/fonts/posters + manifest)

   - With an Elementor-built source page, two extra options appear:
     **keep global colour/typography references** (only for importing into the
     same site) and **atomic (V4) elements** (keep as V4 or convert to classic
     widgets).

---

<div dir="rtl">

## راهنمای فارسی

**Element Finder Studio** یک افزونهٔ کروم برای استخراج و بازسازی صفحه‌های وب است. صفحه را تحلیل می‌کند، ساختارش را به ویجت‌های المنتور نگاشت می‌کند، نتیجه را در یک بیلدر بصری قابل ویرایش می‌کند و در نهایت فایل JSON آمادهٔ ایمپورت در المنتور را به‌همراه بستهٔ کامل فایل‌ها (تصاویر، SVG، فونت) تحویل می‌دهد.

> این ابزار یک مبدل سادهٔ HTML به JSON نیست؛ مجموعه‌ای از موتورهای مستقل است با بیلدر، اعتبارسنجی، ذخیرهٔ پروژه با نسخه‌بندی و امکان اتصال هوش مصنوعی برای نگاشت ویجت‌ها.

### صفحه‌هایی که با المنتور ساخته شده‌اند

در صفحه‌های المنتوری، افزونه استایل‌ها را از ظاهر نهایی صفحه حدس نمی‌زند. المنتور هر تنظیم استایل را از طریق قالب selector همان کنترل در فایل CSS پست (`post-N.css`) می‌نویسد؛ افزونه با نقشه‌ای از همهٔ کنترل‌های المنتور، المنتور پرو و ویجت‌های جانبی نصب‌شده، این CSS را برعکس می‌خواند و این موارد را دقیقاً بازیابی می‌کند:

- تنظیمات ذخیره‌شده با نام دقیق کنترل‌ها، همراه با مقادیر تبلت، موبایل و حالت hover؛
- رنگ‌ها و تایپوگرافی سراسری کیت (`__globals__` به‌همراه مقدار نهایی)؛
- CSS سفارشی هر المان و هر صفحه (المنتور پرو)، عیناً با همان متن نوشته‌شده؛
- محتوای ویجت‌ها از روی قالب رندر خودشان (تگ هدینگ، لینک، آیکون، آیتم‌های لیست)؛
- المان‌های اتمیک المنتور ۴ (V4) به‌همراه کلاس‌های استایل محلی و کلاس‌های سراسری.

نقشهٔ کنترل‌ها از یک وردپرس دارای المنتور ساخته می‌شود. بعد از به‌روزرسانی المنتور یا نصب افزونهٔ ویجت جدید، آن را دوباره بسازید:

```
php -d memory_limit=2G tools/elementor-dump/dump-controls.php C:/path/to/wordpress
```

جزئیات فنی در `docs/ARCHITECTURE.md` بخش «Elementor-built pages» آمده است.

### نصب (حالت توسعه)

1. صفحهٔ `chrome://extensions` را باز کنید و **Developer mode** را روشن کنید.
2. روی **Load unpacked** بزنید و پوشهٔ `extension/` را انتخاب کنید.
3. افزونهٔ «Element Finder Studio» را به نوار ابزار سنجاق کنید.

هیچ مرحلهٔ build لازم نیست؛ کد به‌صورت ES Module مستقیم در مرورگر اجرا می‌شود.

### نحوهٔ استفاده

1. صفحهٔ موردنظر را باز کنید.
2. روی آیکون افزونه بزنید و یکی را انتخاب کنید:
   - **Extract full page**: استخراج کل صفحه؛
   - **Pick an element**: روی هر بخش صفحه کلیک کنید تا فقط همان استخراج شود.
3. **بیلدر** خودکار باز می‌شود:
   - **Structure (ساختار)**: باز و بسته کردن، جابه‌جایی با کشیدن و رها کردن، حذف با کلید `Delete` یا 🗑 و بازگردانی با دوبار کلیک؛
   - **Preview (پیش‌نمایش)**: بازسازی زنده با امکان انتخاب المان و تغییر نما بین دسکتاپ، تبلت و موبایل؛
   - **Inspector (بازرس)**: ویرایش متن، لینک و تصویر، تغییر نوع ویجت، مشاهدهٔ تنظیمات هر دستگاه و برای صفحه‌های المنتوری، مشاهدهٔ تنظیمات دقیق، ارجاع‌های سراسری و CSS سفارشی؛
   - **✓ Validate**: نمایش خطاها، هشدارها و پیشنهادها با رفع یک‌کلیکی؛
   - **💾 Save / 🏷 Version / 📁 Projects**: ذخیرهٔ محلی پروژه، نسخه‌های ثابت، بازگردانی و مقایسه.
4. **⤓ Export**: هر ترکیبی از این خروجی‌ها:
   - **Elementor Template JSON** برای ایمپورت از مسیر المنتور ← Templates ← Saved Templates ← Import؛
   - **Structure JSON**: ساختار سبک برای یکپارچه‌سازی؛
   - **Raw Data JSON**: پشتیبان کامل و بدون افت؛
   - **HTML Snapshot**: سند HTML مستقل از بازسازی؛
   - **Assets Package**: فایل ZIP شامل تصاویر، SVGها، فونت‌ها و فهرست آن‌ها.

   اگر صفحهٔ مبدأ با المنتور ساخته شده باشد، دو گزینهٔ دیگر هم نمایش داده می‌شود:
   - **حفظ ارجاع به رنگ و تایپوگرافی سراسری**: فقط وقتی قالب را در همان سایت ایمپورت می‌کنید؛ در سایت دیگر اگر رنگ سراسری وجود نداشته باشد، المنتور آن استایل را اعمال نمی‌کند. حالت پیش‌فرض، مقدار نهایی را منتقل می‌کند.
   - **المان‌های اتمیک (V4)**: حفظ به‌صورت المان اتمیک (برای المنتور ۴ به بالا) یا تبدیل به ویجت کلاسیک.

### مواردی که از روی صفحه قابل بازیابی نیستند

- **آیکون SVG آپلودی**: المنتور فایل را با شناسهٔ پیوست درون صفحه می‌گذارد و آدرسش در صفحه نیست. روی این المان‌ها هشدار نمایش داده می‌شود تا بعد از ایمپورت آیکون دوباره انتخاب شود (فایل SVG در بستهٔ Assets هست).
- **منوهای وردپرس و تگ‌های داینامیک**: باید در سایت مقصد دوباره تنظیم شوند.

### تست و سنجش دقت

```
node extension/smoke-test.mjs                      # تست‌های واحد موتورها
node tools/e2e/fidelity.mjs <url> --verbose        # مقایسهٔ خروجی با دادهٔ ذخیره‌شدهٔ المنتور
node tools/e2e/extension-run.mjs <url>             # اجرای کامل از طریق خود افزونه
```

</div>

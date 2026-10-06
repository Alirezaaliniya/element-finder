/**
 * Lightweight i18n for the extension UI (popup + builder).
 *
 * - `t(key, params)` looks up the active dictionary, falls back to English,
 *   then to the key itself; `{name}` placeholders interpolate from params.
 * - The language persists in chrome.storage.local and is applied before the
 *   first render (`await initI18n()` at module top level).
 * - Static HTML translates through data-i18n / data-i18n-title /
 *   data-i18n-placeholder attributes; dynamic strings call t() at render time.
 * - Persian flips the UI to RTL (documentElement.dir) — the preview iframe
 *   keeps the SOURCE page's direction and is not affected.
 */

const LANG_KEY = 'ef:lang';
const SUPPORTED = ['en', 'fa'];
let current = 'en';

const DICTS = {
  en: {
    // ---- popup ----
    'popup.tagline': 'Web → Elementor extraction platform',
    'popup.extractFull': 'Extract full page',
    'popup.extractFullSub': 'Analyze the whole page and open the builder',
    'popup.pick': 'Pick an element',
    'popup.pickSub': 'Click any section on the page to extract just it',
    'popup.openBuilder': 'Open builder',
    'popup.openBuilderSub': 'Projects, preview, validation & export',
    'popup.ready': 'Ready',
    'popup.analyzing': 'Analyzing page…',
    'popup.cannotExtract': 'This page cannot be extracted (browser-internal URL).',
    'popup.cancelled': 'Selection cancelled.',
    'popup.extractFailed': 'Extraction failed',
    'popup.extracted': 'Extracted {count} elements — opening builder…',
    'popup.lastRun': 'Last run: {count} elements from {host}',
    'popup.lastRunFailed': 'Last run failed: {error}',
    'popup.initFailed': 'Could not initialize on this page (restricted URL?)',

    // ---- builder chrome ----
    'builder.structure': 'Structure',
    'builder.preview': 'Preview',
    'builder.inspector': 'Inspector',
    'builder.validate': '✓ Validate',
    'builder.save': '💾 Save',
    'builder.version': '🏷 Version',
    'builder.projects': '📁 Projects',
    'builder.export': '⤓ Export',
    'builder.undoTitle': 'Undo (Ctrl+Z)',
    'builder.redoTitle': 'Redo (Ctrl+Y)',
    'builder.versionTitle': 'Freeze current state as a version',
    'builder.desktop': 'Desktop',
    'builder.tablet': 'Tablet ≤1024px',
    'builder.mobile': 'Mobile ≤767px',
    'builder.untitled': 'Untitled project',
    'builder.validationPassed': 'Validation passed — export-ready.',
    'builder.validationIssues': '{errors} error(s), {warnings} warning(s).',
    'builder.nothingToVersion': 'Nothing to version yet.',
    'builder.versionLabelPrompt': 'Version label:',
    'builder.versionFrozen': 'Version "{label}" frozen.',
    'builder.nothingToExport': 'Nothing to export.',
    'builder.nothingToSave': 'Nothing to save.',
    'builder.projectSaved': 'Project saved.',
    'builder.imported': 'Imported {count} elements from {host}.',
    'builder.metaLine': '{url} · extracted {date} · {count} elements',
    'builder.langToggleTitle': 'Switch language / تغییر زبان',

    // ---- inspector ----
    'insp.selectPrompt': 'Select an element in the tree or preview.',
    'insp.element': 'Element',
    'insp.mapping': 'Mapping',
    'insp.text': 'Text',
    'insp.link': 'Link',
    'insp.image': 'Image',
    'insp.form': 'Form',
    'insp.menu': 'Menu',
    'insp.settings': 'Elementor settings',
    'insp.warnings': 'Warnings',
    'insp.actions': 'Actions',
    'insp.label': 'Label',
    'insp.tag': 'Tag',
    'insp.id': 'Id',
    'insp.semantic': 'Semantic',
    'insp.pattern': 'Pattern',
    'insp.source': 'Source',
    'insp.size': 'Size',
    'insp.widgetMapping': 'Widget mapping',
    'insp.searchWidget': 'Search widgets…',
    'insp.noResults': 'No matching widget',
    'insp.containerOption': 'Container (layout)',
    'insp.thirdParty': 'third-party',
    'insp.mappedBy': 'Mapped by {source}{rule} · confidence {confidence}%',
    'insp.ruleSuffix': ' · rule “{rule}”',
    'insp.alternatives': 'Alternatives',
    'insp.editableText': 'Editable text',
    'insp.destinationUrl': 'Destination URL',
    'insp.imageUrl': 'Image URL',
    'insp.formFields': '{count} form field(s)',
    'insp.required': 'required',
    'insp.menuItems': 'Menu items',
    'insp.subItems': '+{count} sub',
    'insp.deviceSettings': '{device} ({count} settings)',
    'insp.exactSettings': 'Exact Elementor settings — from source CSS ({count})',
    'insp.globalRefs': 'Kit global references',
    'insp.customCss': 'Element custom CSS',
    'insp.atomicSettings': 'Atomic (V4) settings',
    'insp.atomicStyles': 'Atomic style classes',
    'insp.noSettings': 'No interpreted settings.',
    'insp.remove': '🗑 Remove from output',
    'insp.restore': '↩ Restore element',

    // ---- tree ----
    'tree.elements': '{count} elements',
    'tree.container': 'container',
    'tree.chipTitle': 'confidence {confidence}% · source: {source}',

    // ---- export dialog ----
    'export.title': 'Export — {count} elements',
    'export.skipValidation': 'Skip validation errors',
    'export.cancel': 'Cancel',
    'export.run': 'Export selected',
    'export.pickFormat': 'Pick at least one format.',
    'export.blocked': 'Blocked: {count} validation error(s). Fix them below or tick "Skip validation errors".',
    'export.building': 'Building {format}…',
    'export.packaging': 'Packaging assets {current}/{total} — {asset}',
    'export.done': 'Done — check your downloads.',
    'export.exported': 'Exported {count} format(s).',
    'export.failed': 'Export failed — see dialog for details.',
    'export.elementorOptions': 'Elementor source options',
    'export.keepGlobals': 'Keep global colour/typography references (import into the SAME site only)',
    'export.atomicMode': 'Atomic (V4) elements',
    'export.atomicKeep': 'Keep as V4 atomic elements (Elementor 4+)',
    'export.atomicClassic': 'Convert to classic widgets',

    // ---- projects dialog ----
    'projects.title': 'Projects',
    'projects.none': 'No saved projects yet. Use 💾 Save in the toolbar.',
    'projects.open': 'Open',
    'projects.close': 'Close',
    'projects.historyTitle': 'Show saved versions',
    'projects.deleteConfirm': 'Delete project "{name}" and all its versions?',
    'projects.deleted': 'Project deleted.',
    'projects.notFound': 'Project not found.',
    'projects.opened': 'Opened "{name}".',
    'projects.meta': '{host} · {count} elements · updated {date}',
    'projects.noVersions': 'No frozen versions.',
    'projects.versionMeta': '{label} · {count} elements',
    'projects.restore': 'Restore',
    'projects.compare': 'Compare to current',
    'projects.restored': 'Restored "{label}". Save to keep it.',

    // ---- validation panel ----
    'validation.ready': '✓ Export-ready',
    'validation.issues': '✗ Issues found',
    'validation.counts': '{errors} errors · {warnings} warnings · {info} notes',
    'validation.fix': 'Fix: {label}',
  },

  fa: {
    // ---- popup ----
    'popup.tagline': 'پلتفرم استخراج وب ← المنتور',
    'popup.extractFull': 'استخراج کل صفحه',
    'popup.extractFullSub': 'تحلیل کل صفحه و باز شدن بیلدر',
    'popup.pick': 'انتخاب یک المان',
    'popup.pickSub': 'روی هر بخش صفحه کلیک کنید تا فقط همان استخراج شود',
    'popup.openBuilder': 'باز کردن بیلدر',
    'popup.openBuilderSub': 'پروژه‌ها، پیش‌نمایش، اعتبارسنجی و خروجی',
    'popup.ready': 'آماده',
    'popup.analyzing': 'در حال تحلیل صفحه…',
    'popup.cannotExtract': 'این صفحه قابل استخراج نیست (آدرس داخلی مرورگر).',
    'popup.cancelled': 'انتخاب لغو شد.',
    'popup.extractFailed': 'استخراج ناموفق بود',
    'popup.extracted': '{count} المان استخراج شد — در حال باز کردن بیلدر…',
    'popup.lastRun': 'آخرین اجرا: {count} المان از {host}',
    'popup.lastRunFailed': 'آخرین اجرا ناموفق بود: {error}',
    'popup.initFailed': 'راه‌اندازی روی این صفحه ممکن نشد (آدرس محدود‌شده؟)',

    // ---- builder chrome ----
    'builder.structure': 'ساختار',
    'builder.preview': 'پیش‌نمایش',
    'builder.inspector': 'بازرسی',
    'builder.validate': '✓ اعتبارسنجی',
    'builder.save': '💾 ذخیره',
    'builder.version': '🏷 نسخه',
    'builder.projects': '📁 پروژه‌ها',
    'builder.export': '⤓ خروجی',
    'builder.undoTitle': 'واگرد (Ctrl+Z)',
    'builder.redoTitle': 'ازنو (Ctrl+Y)',
    'builder.versionTitle': 'ثبت وضعیت فعلی به‌عنوان یک نسخه',
    'builder.desktop': 'دسکتاپ',
    'builder.tablet': 'تبلت ≤۱۰۲۴px',
    'builder.mobile': 'موبایل ≤۷۶۷px',
    'builder.untitled': 'پروژه بدون نام',
    'builder.validationPassed': 'اعتبارسنجی موفق — آماده‌ی خروجی.',
    'builder.validationIssues': '{errors} خطا، {warnings} هشدار.',
    'builder.nothingToVersion': 'هنوز چیزی برای نسخه‌سازی نیست.',
    'builder.versionLabelPrompt': 'برچسب نسخه:',
    'builder.versionFrozen': 'نسخه «{label}» ثبت شد.',
    'builder.nothingToExport': 'چیزی برای خروجی گرفتن نیست.',
    'builder.nothingToSave': 'چیزی برای ذخیره نیست.',
    'builder.projectSaved': 'پروژه ذخیره شد.',
    'builder.imported': '{count} المان از {host} وارد شد.',
    'builder.metaLine': '{url} · استخراج {date} · {count} المان',
    'builder.langToggleTitle': 'Switch language / تغییر زبان',

    // ---- inspector ----
    'insp.selectPrompt': 'یک المان را در درخت یا پیش‌نمایش انتخاب کنید.',
    'insp.element': 'المان',
    'insp.mapping': 'نگاشت ویجت',
    'insp.text': 'متن',
    'insp.link': 'لینک',
    'insp.image': 'تصویر',
    'insp.form': 'فرم',
    'insp.menu': 'منو',
    'insp.settings': 'تنظیمات المنتور',
    'insp.warnings': 'هشدارها',
    'insp.actions': 'عملیات',
    'insp.label': 'برچسب',
    'insp.tag': 'تگ',
    'insp.id': 'شناسه',
    'insp.semantic': 'نوع معنایی',
    'insp.pattern': 'الگو',
    'insp.source': 'منبع',
    'insp.size': 'اندازه',
    'insp.widgetMapping': 'ویجت معادل',
    'insp.searchWidget': 'جستجوی ویجت…',
    'insp.noResults': 'ویجتی یافت نشد',
    'insp.containerOption': 'کانتینر (چیدمان)',
    'insp.thirdParty': 'شخص ثالث',
    'insp.mappedBy': 'نگاشت توسط {source}{rule} · اطمینان {confidence}٪',
    'insp.ruleSuffix': ' · قانون «{rule}»',
    'insp.alternatives': 'گزینه‌های دیگر',
    'insp.editableText': 'متن قابل ویرایش',
    'insp.destinationUrl': 'آدرس مقصد',
    'insp.imageUrl': 'آدرس تصویر',
    'insp.formFields': '{count} فیلد فرم',
    'insp.required': 'اجباری',
    'insp.menuItems': 'آیتم‌های منو',
    'insp.subItems': '{count}+ زیرمنو',
    'insp.deviceSettings': '{device} ({count} تنظیم)',
    'insp.exactSettings': 'تنظیمات دقیق المنتور — از CSS منبع ({count})',
    'insp.globalRefs': 'ارجاع‌های سراسری کیت',
    'insp.customCss': 'CSS سفارشی المان',
    'insp.atomicSettings': 'تنظیمات اتمیک (V4)',
    'insp.atomicStyles': 'کلاس‌های استایل اتمیک',
    'insp.noSettings': 'تنظیم تفسیر‌شده‌ای وجود ندارد.',
    'insp.remove': '🗑 حذف از خروجی',
    'insp.restore': '↩ بازگرداندن المان',

    // ---- tree ----
    'tree.elements': '{count} المان',
    'tree.container': 'کانتینر',
    'tree.chipTitle': 'اطمینان {confidence}٪ · منبع: {source}',

    // ---- export dialog ----
    'export.title': 'خروجی — {count} المان',
    'export.skipValidation': 'نادیده گرفتن خطاهای اعتبارسنجی',
    'export.cancel': 'انصراف',
    'export.run': 'خروجی از موارد انتخابی',
    'export.pickFormat': 'حداقل یک فرمت انتخاب کنید.',
    'export.blocked': 'مسدود شد: {count} خطای اعتبارسنجی. آن‌ها را برطرف کنید یا «نادیده گرفتن خطاها» را بزنید.',
    'export.building': 'در حال ساخت {format}…',
    'export.packaging': 'بسته‌بندی فایل‌ها {current}/{total} — {asset}',
    'export.done': 'انجام شد — پوشه‌ی دانلودها را ببینید.',
    'export.exported': 'خروجی {count} فرمت گرفته شد.',
    'export.failed': 'خروجی ناموفق — جزئیات در همین پنجره.',
    'export.elementorOptions': 'تنظیمات منبع المنتور',
    'export.keepGlobals': 'حفظ ارجاع به رنگ/تایپوگرافی سراسری (فقط برای ایمپورت در همان سایت)',
    'export.atomicMode': 'المان‌های اتمیک (V4)',
    'export.atomicKeep': 'حفظ به‌صورت المان اتمیک V4 (المنتور ۴ به بالا)',
    'export.atomicClassic': 'تبدیل به ویجت‌های کلاسیک',

    // ---- projects dialog ----
    'projects.title': 'پروژه‌ها',
    'projects.none': 'هنوز پروژه‌ای ذخیره نشده. از دکمه‌ی 💾 ذخیره استفاده کنید.',
    'projects.open': 'باز کردن',
    'projects.close': 'بستن',
    'projects.historyTitle': 'نمایش نسخه‌های ذخیره‌شده',
    'projects.deleteConfirm': 'پروژه «{name}» و همه‌ی نسخه‌هایش حذف شود؟',
    'projects.deleted': 'پروژه حذف شد.',
    'projects.notFound': 'پروژه پیدا نشد.',
    'projects.opened': '«{name}» باز شد.',
    'projects.meta': '{host} · {count} المان · به‌روزرسانی {date}',
    'projects.noVersions': 'نسخه‌ی ثبت‌شده‌ای نیست.',
    'projects.versionMeta': '{label} · {count} المان',
    'projects.restore': 'بازگردانی',
    'projects.compare': 'مقایسه با وضعیت فعلی',
    'projects.restored': '«{label}» بازگردانی شد. برای نگه داشتن، ذخیره کنید.',

    // ---- validation panel ----
    'validation.ready': '✓ آماده‌ی خروجی',
    'validation.issues': '✗ مشکلاتی پیدا شد',
    'validation.counts': '{errors} خطا · {warnings} هشدار · {info} نکته',
    'validation.fix': 'اصلاح: {label}',
  },
};

/** Persian search synonyms for widget types — lets the picker match فارسی. */
export const WIDGET_SYNONYMS_FA = {
  heading: 'عنوان تیتر سرتیتر',
  'text-editor': 'متن پاراگراف ویرایشگر',
  image: 'تصویر عکس',
  button: 'دکمه',
  video: 'ویدیو فیلم',
  divider: 'جداکننده خط',
  spacer: 'فاصله',
  icon: 'آیکون',
  'icon-box': 'جعبه آیکون',
  'icon-list': 'لیست آیکون',
  'image-box': 'جعبه تصویر',
  'image-carousel': 'اسلایدر تصویر کاروسل',
  'image-gallery': 'گالری تصاویر',
  counter: 'شمارنده عدد',
  progress: 'نوار پیشرفت',
  testimonial: 'نظر مشتری',
  tabs: 'تب زبانه',
  accordion: 'آکاردئون',
  toggle: 'تاگل بازشو',
  'social-icons': 'شبکه‌های اجتماعی',
  alert: 'هشدار اعلان',
  html: 'اچ‌تی‌ام‌ال کد',
  'star-rating': 'امتیاز ستاره',
  'nested-tabs': 'تب تودرتو',
  'nested-accordion': 'آکاردئون تودرتو',
  'nav-menu': 'منو ناوبری',
  'mega-menu': 'مگامنو',
  form: 'فرم تماس',
  login: 'ورود لاگین',
  posts: 'نوشته‌ها مطالب',
  slides: 'اسلاید',
  'nested-carousel': 'کاروسل اسلایدر',
  'loop-carousel': 'کاروسل حلقه',
  'loop-grid': 'گرید حلقه',
  'price-table': 'جدول قیمت',
  'price-list': 'لیست قیمت',
  countdown: 'شمارش معکوس تایمر',
  'flip-box': 'جعبه چرخشی',
  'call-to-action': 'فراخوان اقدام',
  blockquote: 'نقل قول',
  google_maps: 'نقشه گوگل',
  'search-form': 'فرم جستجو',
  'theme-site-logo': 'لوگو سایت',
};

/* ------------------------------------------------------------------ */

export function t(key, params) {
  let text = DICTS[current]?.[key] ?? DICTS.en[key] ?? key;
  if (params) {
    for (const [name, value] of Object.entries(params)) {
      text = text.replaceAll(`{${name}}`, String(value));
    }
  }
  return text;
}

export function getLang() {
  return current;
}

export function isRtl() {
  return current === 'fa';
}

/** Persist the language; callers reload the page to re-render everything. */
export async function setLang(lang) {
  if (!SUPPORTED.includes(lang)) return;
  current = lang;
  try {
    await chrome.storage.local.set({ [LANG_KEY]: lang });
  } catch {
    try { localStorage.setItem(LANG_KEY, lang); } catch { /* ignore */ }
  }
}

/** Load the stored language (default en) and localize the given document. */
export async function initI18n(doc) {
  let stored = null;
  try {
    stored = (await chrome.storage.local.get(LANG_KEY))[LANG_KEY];
  } catch {
    try { stored = localStorage.getItem(LANG_KEY); } catch { /* ignore */ }
  }
  if (SUPPORTED.includes(stored)) current = stored;
  if (doc) applyTranslations(doc);
  return current;
}

/** Translate data-i18n(-title|-placeholder) elements + document direction. */
export function applyTranslations(doc) {
  doc.documentElement.lang = current;
  doc.documentElement.dir = isRtl() ? 'rtl' : 'ltr';
  for (const el of doc.querySelectorAll('[data-i18n]')) {
    el.textContent = t(el.dataset.i18n);
  }
  for (const el of doc.querySelectorAll('[data-i18n-title]')) {
    el.title = t(el.dataset.i18nTitle);
  }
  for (const el of doc.querySelectorAll('[data-i18n-placeholder]')) {
    el.placeholder = t(el.dataset.i18nPlaceholder);
  }
}

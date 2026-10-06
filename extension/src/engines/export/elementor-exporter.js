/**
 * IR -> Elementor template JSON (the `version: "0.4"` page/section format
 * produced by Elementor's own export, validated against real exports).
 *
 * Content settings come from SETTING_ADAPTERS (one per widget type); style
 * settings come from the CSS engine under canonical names and are translated
 * to real control names by widget-controls.js — `color` becomes `title_color`
 * on a heading, `button_text_color` on a button, `_background_color` on any
 * widget's Advanced tab — with `_tablet` / `_mobile` suffixes added only for
 * controls Elementor actually registers as responsive.
 */

import { BREAKPOINTS, DEVICE_SUFFIX, EL_TYPES, MAPPING_SOURCES } from '../../common/constants.js';
import { compactObject, escapeHtml } from '../../common/utils.js';
import { elementorId } from '../../common/utils.js';
import { classicEquivalent } from '../mapping/widget-catalog.js';
import { isResponsiveKey, resolveSettingKey } from './widget-controls.js';

/* ------------------------------------------------------------------ *
 * Widget setting adapters
 * Each receives (node) and returns widget-specific *content* settings.
 * Style settings flow through styleSettings() + widget-controls.js.
 * ------------------------------------------------------------------ */

const SETTING_ADAPTERS = {
  heading(node) {
    return {
      title: node.content.text ?? '',
      header_size: node.content.headerSize ?? 'h2',
      link: node.content.linkHref ? linkControl(node.content.linkHref) : undefined,
    };
  },
  'text-editor'(node) {
    const html = node.content.html || (node.content.text ? `<p>${escapeHtml(node.content.text)}</p>` : '');
    return { editor: html };
  },
  image(node, ctx) {
    const url = node.content.src ?? firstAssetUrl(node, ctx, ['image', 'background']) ?? '';
    return {
      image: { url, id: '', alt: node.content.alt ?? '', source: 'library' },
      image_size: 'full',
      link_to: node.content.linkHref ? 'custom' : undefined,
      link: node.content.linkHref ? linkControl(node.content.linkHref) : undefined,
    };
  },
  button(node) {
    return {
      text: node.content.text ?? 'Click here',
      link: node.content.href ? linkControl(node.content.href, node.content.target === '_blank') : undefined,
    };
  },
  video(node) {
    if (node.content.videoProvider === 'youtube') return { video_type: 'youtube', youtube_url: node.content.src };
    if (node.content.videoProvider === 'vimeo') return { video_type: 'vimeo', vimeo_url: node.content.src };
    return {
      video_type: 'hosted',
      hosted_url: node.content.src ? { url: node.content.src, id: '', source: 'library' } : undefined,
      autoplay: node.content.autoplay ? 'yes' : undefined,
      loop: node.content.loop ? 'yes' : undefined,
      mute: node.content.muted ? 'yes' : undefined,
    };
  },
  google_maps(node) {
    return { address: node.content.src ?? '' };
  },
  icon(node) {
    if (node.content.svgMarkup) {
      return { selected_icon: { value: { url: '', id: '' }, library: 'svg' }, _ef_inline_svg: node.content.svgMarkup };
    }
    return { selected_icon: { value: 'fas fa-star', library: 'fa-solid' } };
  },
  'icon-list'(node) {
    return {
      icon_list: (node.content.listItems ?? []).map((it) => compactObject({
        text: it.text,
        link: it.href ? linkControl(it.href) : undefined,
        selected_icon: { value: 'fas fa-check', library: 'fa-solid' },
        _id: elementorId(),
      })),
    };
  },
  'nav-menu'(node) {
    // The actual WP menu must exist on the target site; we carry the items
    // in a custom key so they can be recreated.
    return { _ef_menu_items: node.content.menu ?? [], layout: 'horizontal' };
  },
  form(node) {
    return {
      form_name: 'Imported form',
      form_fields: (node.content.fields ?? []).map((f) => compactObject({
        custom_id: f.name || undefined,
        field_type: mapFormFieldType(f.type),
        field_label: f.label || f.placeholder || f.name,
        placeholder: f.placeholder || undefined,
        required: f.required ? 'true' : undefined,
        field_options: f.options?.length ? f.options.join('\n') : undefined,
        _id: elementorId(),
      })),
    };
  },
  html(node) {
    return { html: node.content.html ?? node.content.svgMarkup ?? (node.content.text ? `<div>${escapeHtml(node.content.text)}</div>` : '<div></div>') };
  },
  blockquote(node) {
    return { blockquote_content: node.content.text ?? '' };
  },
  spacer(node) {
    return { space: { unit: 'px', size: Math.min(200, node.rect?.height ?? 24), sizes: [] } };
  },
  divider() {
    return {};
  },
  'menu-anchor'(node) {
    return { anchor: node.attrs?.id ?? '' };
  },
  alert(node) {
    const c = node.content.composite ?? {};
    return {
      alert_title: c.title ?? node.content.text ?? '',
      alert_description: c.description ?? '',
    };
  },
  counter(node) {
    const c = node.content.counter ?? parseCounterText(node.content.text);
    return compactObject({
      starting_number: 0,
      ending_number: c?.number ?? 0,
      prefix: c?.prefix || undefined,
      suffix: c?.suffix || undefined,
      title: c?.title || undefined,
    });
  },
  progress(node) {
    const c = node.content.progress ?? {};
    const fromText = parseFloat(/(\d{1,3})\s*%/.exec(node.content.text ?? '')?.[1]);
    const percent = c.percent ?? (Number.isFinite(fromText) ? fromText : 100);
    return {
      title: c.title ?? '',
      percent: { unit: '%', size: percent, sizes: [] },
    };
  },
  'star-rating'(node) {
    return { rating: node.content.rating ?? 5 };
  },
  tabs: titledItemsAdapter,
  accordion: titledItemsAdapter,
  toggle: titledItemsAdapter,
  'nested-tabs'(node) {
    return { tabs: nestedTitles(node).map((t) => ({ tab_title: t, _id: elementorId() })) };
  },
  'nested-accordion'(node) {
    return { items: nestedTitles(node).map((t) => ({ item_title: t, _id: elementorId() })) };
  },
  'image-carousel'(node, ctx) {
    return { carousel: nodeImages(node, ctx).map((i) => ({ id: '', url: i.src })) };
  },
  'image-gallery'(node, ctx) {
    return { wp_gallery: nodeImages(node, ctx).map((i) => ({ id: '', url: i.src })) };
  },
  'flip-box'(node) {
    const c = node.content.composite ?? {};
    return compactObject({
      title_text_a: c.title ?? node.content.text ?? '',
      description_text_a: c.description ?? '',
      title_text_b: c.title ?? '',
      description_text_b: c.description ?? '',
      button_text: c.linkText || undefined,
      link: c.href ? linkControl(c.href) : undefined,
    });
  },
  'price-table'(node) {
    const c = node.content.composite ?? {};
    const price = /[\d.,]+/.exec(c.description ?? node.content.text ?? '')?.[0];
    return compactObject({
      heading: c.title ?? '',
      sub_heading: c.description ?? undefined,
      price: price ?? '0',
      button_text: c.linkText || undefined,
      link: c.href ? linkControl(c.href) : undefined,
    });
  },
  'social-icons'(node) {
    // Links may sit below wrapper layers — search descendants, not children.
    const links = [];
    (function collect(n) {
      for (const c of n.children ?? []) {
        if (c.tag === 'a' && c.content.href && links.length < 10) links.push(c);
        else collect(c);
      }
    })(node);
    return {
      social_icon_list: links.map((l) => ({
        social_icon: { value: socialIcon(l.content.href), library: 'fa-brands' },
        link: linkControl(l.content.href, true),
        _id: elementorId(),
      })),
    };
  },

  // --- Composite widgets (hoisted `content.composite`, see content-hoisting.js)
  'icon-box'(node) {
    const c = node.content.composite ?? {};
    return {
      title_text: c.title ?? node.content.text ?? '',
      description_text: c.description ?? '',
      selected_icon: c.svgMarkup
        ? { value: { url: '', id: '' }, library: 'svg' }
        : { value: 'fas fa-star', library: 'fa-solid' },
      link: c.href ? linkControl(c.href) : undefined,
    };
  },
  'image-box'(node, ctx) {
    const c = node.content.composite ?? {};
    return {
      title_text: c.title ?? node.content.text ?? '',
      description_text: c.description ?? '',
      image: { url: c.imageUrl ?? firstAssetUrl(node, ctx, ['image']) ?? '', id: '', alt: c.imageAlt ?? '', source: 'library' },
      link: c.href ? linkControl(c.href) : undefined,
    };
  },
  testimonial(node, ctx) {
    const c = node.content.composite ?? {};
    return {
      testimonial_content: c.description ?? node.content.text ?? '',
      testimonial_name: c.title ?? '',
      testimonial_image: c.imageUrl
        ? { url: c.imageUrl, id: '', source: 'library' }
        : undefined,
    };
  },
  'call-to-action'(node, ctx) {
    const c = node.content.composite ?? {};
    return {
      title: c.title ?? node.content.text ?? '',
      description: c.description ?? '',
      button: c.linkText ?? '',
      link: c.href ? linkControl(c.href) : undefined,
      bg_image: c.imageUrl ? { url: c.imageUrl, id: '', source: 'library' } : undefined,
    };
  },
};

/**
 * Classic tabs/accordion/toggle share the `tabs` repeater shape:
 * [{ tab_title, tab_content, _id }] — content is HTML.
 */
function titledItemsAdapter(node) {
  const items = node.content.items ?? [];
  return {
    tabs: items.map((it) => ({
      tab_title: it.title,
      tab_content: /</.test(it.body) ? it.body : `<p>${escapeHtml(it.body)}</p>`,
      _id: elementorId(),
    })),
  };
}

/** Item titles for nested tabs/accordion — must match the child-container count. */
function nestedTitles(node) {
  const children = (node.children ?? []).filter((c) => !c.hidden);
  const count = Math.max(children.length, 1);
  const titles = (node.content.items ?? []).map((it) => it.title);
  while (titles.length < count) titles.push(`Item ${titles.length + 1}`);
  return titles.slice(0, count);
}

/** Gallery/carousel images: hoisted list first, node assets as fallback. */
function nodeImages(node, ctx) {
  if (node.content.images?.length) return node.content.images;
  const out = [];
  for (const id of node.assets ?? []) {
    const asset = ctx?.assetsById?.get(id);
    if (asset?.url && (asset.type === 'image' || asset.type === 'background')) {
      out.push({ src: asset.url, alt: asset.meta?.alt ?? '' });
    }
  }
  return out;
}

/** "1,500+ customers" -> { number: 1500, prefix: '', suffix: '+ customers' } */
function parseCounterText(text) {
  const m = /([\d][\d.,\s]*)/.exec(text ?? '');
  if (!m) return null;
  return {
    number: parseFloat(m[1].replace(/[,\s]/g, '')) || 0,
    prefix: text.slice(0, m.index).trim(),
    suffix: text.slice(m.index + m[1].length).trim(),
  };
}

/** Flex/grid layout keys a widget cannot carry — they stay container-only. */
const CONTAINER_ONLY_KEYS = new Set([
  'flex_direction', 'flex_wrap', 'flex_justify_content', 'flex_align_items',
  'flex_align_content', 'flex_gap',
]);

/** Source tags a container can reproduce via its `html_tag` control. */
const CONTAINER_HTML_TAGS = new Set(['header', 'footer', 'main', 'article', 'section', 'aside', 'nav']);

/* ------------------------------------------------------------------ *
 * Tree conversion
 * ------------------------------------------------------------------ */

/**
 * @param {object} snapshot IR snapshot
 * @param {object} [options]
 * @param {string} [options.title]
 * @param {'page'|'section'|'container'} [options.type]
 * @param {boolean} [options.keepGlobals=false] keep kit global references
 *        (`__globals__`) next to the resolved values. Only useful when the
 *        template is imported into the SAME site: a missing global makes
 *        Elementor skip the style entirely.
 * @param {'keep'|'classic'} [options.atomic='keep'] export atomic (V4)
 *        elements as atomic JSON, or convert them to classic widgets for
 *        sites without Elementor 4.
 * @returns {object} Elementor template JSON (importable .json file content)
 */
export function exportElementorTemplate(snapshot, options = {}) {
  const ctx = {
    assetsById: new Map((snapshot.assets ?? []).map((a) => [a.id, a])),
    keepGlobals: !!options.keepGlobals,
    atomic: options.atomic === 'classic' ? 'classic' : 'keep',
    usedGlobalClassIds: new Set(),
  };
  // Full-page scope: <body> is just a host, its children become the
  // template's top-level containers. Element scope: the picked element IS
  // the design (its flex/min-height/background settings must survive), so it
  // exports as the single root container — matching how Elementor exports a
  // section/container template (type "container").
  const isElementScope = snapshot.meta?.scope === 'element';
  // On an Elementor page the template is the Elementor documents' content
  // (header + page + footer elements); theme chrome between <body> and the
  // documents (wrappers, notices, plugin overlays) is not part of it.
  const nativeTop = !isElementScope && snapshot.meta?.elementor ? shallowestNative(snapshot.tree) : [];
  const rootChildren = nativeTop.length ? nativeTop : visibleChildren(snapshot.tree);
  const content = (isElementScope || !rootChildren.length)
    ? [convertNode(snapshot.tree, ctx, false)].filter(Boolean)
    : rootChildren.map((n) => convertNode(n, ctx, false)).filter(Boolean);

  const template = {
    content,
    page_settings: buildPageSettings(snapshot),
    version: '0.4',
    title: options.title || snapshot.meta.title || 'Imported page',
    type: options.type || (isElementScope ? 'container' : 'page'),
  };
  // Atomic global classes travel as a snapshot Elementor merges on import
  // (modules/global-classes/utils/template-library-global-classes.php).
  const globalClasses = globalClassesSnapshot(snapshot, ctx.usedGlobalClassIds);
  if (globalClasses) template.global_classes = globalClasses;
  return template;
}

function globalClassesSnapshot(snapshot, usedIds) {
  if (!usedIds.size) return null;
  const items = {};
  const order = [];
  for (const def of Object.values(snapshot.globals?.atomicClasses ?? {})) {
    if (!usedIds.has(def.id)) continue;
    items[def.id] = def;
    order.push(def.id);
  }
  return order.length ? { items, order } : null;
}

function visibleChildren(node) {
  return (node?.children ?? []).filter((c) => !c.hidden);
}

/** Top-most native Elementor elements, in document order. */
function shallowestNative(root) {
  const out = [];
  (function walk(node) {
    for (const child of visibleChildren(node)) {
      if (child.semantic?.elementorNative) out.push(child);
      else walk(child);
    }
  })(root);
  return out;
}

function convertNode(node, ctx, isInner) {
  if (!node || node.hidden || !node.mapping) return null;
  const { elType } = node.mapping;
  let { widgetType } = node.mapping;
  const native = node.semantic?.elementorNative;

  if (native?.atomic && node.mapping.source === MAPPING_SOURCES.ELEMENTOR_NATIVE) {
    if (ctx.atomic === 'keep') return asAtomic(node, ctx, isInner);
    // Classic conversion: the generic adapters + computed settings path.
    if (elType === EL_TYPES.WIDGET) widgetType = classicEquivalent(widgetType) ?? 'html';
  }

  if (elType === EL_TYPES.CONTAINER) return asContainer(node, ctx, isInner);

  const adapter = SETTING_ADAPTERS[widgetType];
  const children = visibleChildren(node);

  // A widget cannot carry child elements in Elementor. Content hoisting
  // (mapping engine) absorbs descendants for known widget types; for an
  // unknown composite mapping the children would be silently lost — prefer
  // preserving the structure as a container over dropping content. A mapping
  // the USER chose explicitly is never overridden this way.
  if (
    children.length && !adapter && !isNestedWidget(widgetType) &&
    node.mapping.source !== MAPPING_SOURCES.USER &&
    !node.semantic.elementorNative && !node.content.text && !node.content.html
  ) {
    return asContainer(node, ctx, isInner);
  }

  // Native widgets read back through their render template carry exact
  // content; the generic adapters would only add guessed defaults.
  const exactContent = nativeContent(node, widgetType);
  const contentSettings = Object.keys(exactContent).length
    ? exactContent
    : adapter ? adapter(node, ctx) : defaultWidgetContent(node);
  // Style: the exact settings recovered from Elementor's generated CSS when
  // available (native, not re-mapped), else the computed-style translation.
  // Native data-settings (JS-driven config: background_background, _position,
  // menu layout, swiper options) are authoritative — overlay them last.
  const settings = withCommon(node, {
    ...contentSettings,
    ...(exactSettings(node, widgetType, ctx) ?? styleSettings(node, widgetType)),
    ...nativeSettings(node),
  }, widgetType);
  applyRepeaterStyles(node, settings);
  // Native skin variants (e.g. loop-carousel.product) export Elementor-style.
  if (node.semantic.elementorNative?.skin) settings._skin = node.semantic.elementorNative.skin;

  const element = {
    id: node.id,
    settings: compactObject(settings),
    elements: [],
    isInner: false,
    widgetType,
    elType: 'widget',
  };

  // Nested-capable widgets (tabs/accordion/carousel) keep children as
  // containers. The DOM nests slides under swiper/viewport wrappers — flatten
  // to the native Elementor containers, which is what Elementor's own export
  // stores as the nested widget's elements.
  if (isNestedWidget(widgetType)) {
    const slides = nativeChildContainers(node);
    element.elements = alignNestedItems(
      widgetType,
      element.settings,
      (slides.length ? slides : children).map((c) => ({ node: c, el: convertNode(c, ctx, true) })).filter((x) => x.el),
    );
  }
  return element;
}

/** Repeater that a nested widget's child containers correspond to, 1:1. */
const NESTED_ITEMS_KEY = {
  'nested-tabs': 'tabs',
  'nested-accordion': 'items',
  'nested-carousel': 'carousel_items',
  'mega-menu': 'menu_items',
};

/**
 * Elementor requires one child container per repeater item. Items whose panel
 * is not rendered (a mega-menu item without dropdown content) still own an
 * empty container; rendered panels carry their 1-based `data-tab-index`.
 */
function alignNestedItems(widgetType, settings, converted) {
  const items = settings[NESTED_ITEMS_KEY[widgetType]];
  if (!Array.isArray(items) || items.length <= converted.length) return converted.map((x) => x.el);
  const slots = new Array(items.length).fill(null);
  const unplaced = [];
  for (const x of converted) {
    const index = Number(x.node.attrs?.['data-tab-index']) - 1;
    if (Number.isInteger(index) && index >= 0 && index < slots.length && !slots[index]) slots[index] = x.el;
    else unplaced.push(x.el);
  }
  for (let i = 0; i < slots.length; i++) {
    if (!slots[i]) slots[i] = unplaced.shift() ?? emptyContainer();
  }
  return slots;
}

function emptyContainer() {
  return { id: elementorId(), settings: {}, elements: [], isInner: true, elType: 'container' };
}

/** Shallowest native Elementor containers below a node (without descending into them). */
function nativeChildContainers(node) {
  const found = [];
  const queue = [...visibleChildren(node)];
  while (queue.length) {
    const n = queue.shift();
    if (n.semantic?.elementorNative?.elType === 'container' || n.semantic?.elementorNative?.elType === 'section') {
      found.push(n);
      continue;
    }
    queue.push(...visibleChildren(n));
  }
  return found;
}

function asContainer(node, ctx, isInner) {
  const exact = exactSettings(node, null, ctx);
  const base = exact ? { ...exact, ...containerTag(node) } : containerSettings(node);
  return {
    id: node.id,
    settings: compactObject(withCommon(node, { ...base, ...nativeSettings(node) }, null)),
    elements: visibleChildren(node).map((c) => convertNode(c, ctx, true)).filter(Boolean),
    isInner,
    elType: 'container',
  };
}

/** Original Elementor data-settings for native elements (sparse, frontend-only). */
function nativeSettings(node) {
  const native = node.semantic.elementorNative;
  if (!native?.settings || native.atomic) return {};
  return native.settings;
}

/** Content read back through the native widget's render template. */
function nativeContent(node, widgetType) {
  const native = node.semantic?.elementorNative;
  if (!native?.content || native.atomic || node.mapping?.source !== MAPPING_SOURCES.ELEMENTOR_NATIVE) return {};
  if (widgetType !== native.widgetType) return {};
  return native.content;
}

/**
 * Settings recovered from the source page's generated CSS by the Elementor
 * Native Engine — exact control names and values, per breakpoint. Used only
 * while the node keeps its native mapping: a user re-map invalidates them.
 */
function exactSettings(node, widgetType, ctx) {
  const native = node.semantic?.elementorNative;
  const exact = native?.exact;
  if (!exact || native.atomic || node.mapping?.source !== MAPPING_SOURCES.ELEMENTOR_NATIVE) return null;
  if (widgetType && widgetType !== native.widgetType) return null;
  // A widget type the controls map does not know (third-party, newer plugin)
  // has no reversed settings; the computed-style path is better than nothing.
  if (!exact.controlsKnown && !exact.customCss) return null;
  const out = exact.controlsKnown ? { ...exact.settings } : styleSettings(node, widgetType);
  if (ctx.keepGlobals && Object.keys(exact.globals ?? {}).length) out.__globals__ = { ...exact.globals };
  if (exact.customCss) out.custom_css = exact.customCss;
  return out;
}

/**
 * Repeater item styles (`{{CURRENT_ITEM}}` selectors) belong to the item with
 * the same `_id`; adapters keep source item ids where the DOM exposes them.
 */
function applyRepeaterStyles(node, settings) {
  const repeaters = node.semantic?.elementorNative?.exact?.repeaters;
  if (!repeaters) return;
  for (const [name, byItem] of Object.entries(repeaters)) {
    const items = settings[name];
    if (!Array.isArray(items)) continue;
    for (const item of items) {
      if (item?._id && byItem[item._id]) Object.assign(item, byItem[item._id]);
    }
  }
}

/* ------------------------------------------------------------------ *
 * Atomic (V4) elements
 * ------------------------------------------------------------------ */

function asAtomic(node, ctx, isInner) {
  const native = node.semantic.elementorNative;
  const data = native.atomicData ?? { settings: {}, styles: {}, classIds: [] };
  const { __svgMarkup: svgMarkup, ...settings } = data.settings ?? {};

  // e-svg's file URL is not recoverable from the page; keep the drawing.
  if (native.widgetType === 'e-svg') {
    return {
      id: node.id,
      settings: compactObject({ html: svgMarkup ?? node.content.svgMarkup ?? '' }),
      elements: [],
      isInner: false,
      widgetType: 'html',
      elType: 'widget',
    };
  }

  if (data.classIds?.length) {
    settings.classes = { $$type: 'classes', value: [...data.classIds] };
    for (const id of data.classIds) if (id.startsWith('g-')) ctx.usedGlobalClassIds.add(id);
  }

  const isWidget = native.elType === 'widget';
  const element = {
    id: node.id,
    elType: isWidget ? 'widget' : native.elType,
    settings,
    styles: data.styles ?? {},
    editor_settings: [],
    version: '0.0',
    isLocked: false,
    elements: isWidget ? [] : visibleChildren(node).map((c) => convertNode(c, ctx, true)).filter(Boolean),
    isInner: isWidget ? false : isInner,
  };
  if (isWidget) element.widgetType = native.widgetType;
  return element;
}

/**
 * Settings shared by every element type: custom CSS classes and the source
 * element id. The class control is `css_classes` on a container but
 * `_css_classes` on a widget (container.php vs common-base.php), so it has to
 * be resolved like any other key — writing the wrong one loses the classes and
 * with them the page-level custom CSS this exporter also emits.
 */
function withCommon(node, settings, widgetType = null) {
  // Hidden on desktop at extraction time (Elementor responsive visibility).
  if (node.hiddenOn?.includes('desktop') && !settings.hide_desktop) settings.hide_desktop = 'hidden-desktop';
  const classes = (node.customClasses ?? []).join(' ').trim();
  const classKey = resolveSettingKey('_css_classes', widgetType);
  if (classes && classKey && !settings[classKey]) settings[classKey] = classes;
  // Keep in-page anchors (`#pricing`) working after import.
  const id = node.attrs?.id;
  if (id && !settings._element_id && /^[A-Za-z][\w:.-]*$/.test(id)) settings._element_id = id;
  return settings;
}

function firstAssetUrl(node, ctx, types) {
  for (const id of node.assets ?? []) {
    const asset = ctx?.assetsById?.get(id);
    if (asset?.url && types.includes(asset.type)) return asset.url;
  }
  return null;
}

function isNestedWidget(widgetType) {
  return ['nested-tabs', 'nested-accordion', 'nested-carousel', 'mega-menu', 'off-canvas'].includes(widgetType);
}

function containerSettings(node) {
  const out = styleSettings(node, null);
  // Containers sized by the source page: preserve percentage-ish widths.
  const w = node.styles.desktop?.width;
  if (w && w.endsWith('%')) out.width = { unit: '%', size: parseFloat(w), sizes: [] };
  Object.assign(out, containerTag(node));
  return compactObject(out);
}

/** A <header>/<nav>/<footer> section keeps its landmark tag on import. */
function containerTag(node) {
  return CONTAINER_HTML_TAGS.has(node.tag) ? { html_tag: node.tag } : {};
}

/**
 * Canonical interpreted settings -> the control names this element actually
 * exposes, per device. Keys with no counterpart on the target are dropped
 * rather than exported under a name Elementor stores but never renders.
 */
function styleSettings(node, widgetType) {
  const out = {};
  for (const device of [BREAKPOINTS.DESKTOP, BREAKPOINTS.TABLET, BREAKPOINTS.MOBILE]) {
    const suffix = DEVICE_SUFFIX[device];
    const src = node.settings[device] ?? {};
    for (const [key, value] of Object.entries(src)) {
      // A wrapper div that became a widget had its width interpreted as a
      // container width; on a widget that is the element-width control.
      if (widgetType && key === 'width') {
        out[suffixKey('_element_width', suffix)] = 'initial';
        out[suffixKey('_element_custom_width', suffix)] = value;
        continue;
      }
      if (widgetType && CONTAINER_ONLY_KEYS.has(key)) continue;
      // Non-responsive controls have no `_tablet` / `_mobile` twin.
      if (suffix && !isResponsiveKey(key)) continue;
      const resolved = resolveSettingKey(key, widgetType);
      if (!resolved) continue;
      out[suffixKey(resolved, suffix)] = value;
    }
  }
  return out;
}

function suffixKey(key, suffix) {
  if (!suffix) return key;
  // hide_mobile-style keys already carry their device.
  if (key.endsWith(suffix)) return key;
  return `${key}${suffix}`;
}

function defaultWidgetContent(node) {
  // Unknown/third-party widget: preserve native settings when available.
  if (node.semantic.elementorNative?.settings) return node.semantic.elementorNative.settings;
  if (node.content.text) return { title: node.content.text };
  return {};
}

function buildPageSettings(snapshot) {
  const settings = {};
  // Page-level custom CSS keeps custom-class styling working after import
  // (pairs with the preserved _css_classes on elements).
  if (snapshot.meta.customCss) settings.custom_css = snapshot.meta.customCss;
  if (snapshot.meta.dir === 'rtl') settings._ef_source_direction = 'rtl';
  if (snapshot.meta.url) settings._ef_source_url = snapshot.meta.url;
  return settings;
}

function linkControl(url, blank = false) {
  return { url, is_external: blank ? 'on' : '', nofollow: '', custom_attributes: '' };
}

function mapFormFieldType(type) {
  const map = {
    text: 'text', email: 'email', tel: 'tel', url: 'url', number: 'number',
    textarea: 'textarea', select: 'select', checkbox: 'checkbox', radio: 'radio',
    date: 'date', time: 'time', file: 'upload', password: 'text', search: 'text',
  };
  return map[type] ?? 'text';
}

function socialIcon(href) {
  const map = [
    [/facebook/, 'fab fa-facebook'], [/twitter|x\.com/, 'fab fa-x-twitter'],
    [/instagram/, 'fab fa-instagram'], [/linkedin/, 'fab fa-linkedin'],
    [/youtube/, 'fab fa-youtube'], [/telegram/, 'fab fa-telegram'],
    [/whatsapp/, 'fab fa-whatsapp'], [/pinterest/, 'fab fa-pinterest'],
    [/tiktok/, 'fab fa-tiktok'], [/github/, 'fab fa-github'],
  ];
  for (const [re, icon] of map) if (re.test(href)) return icon;
  return 'fas fa-link';
}

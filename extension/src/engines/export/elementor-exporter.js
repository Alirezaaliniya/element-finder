/**
 * IR -> Elementor template JSON (the `version: "0.4"` page/section format
 * produced by Elementor's own export, validated against real exports).
 *
 * Generic interpreted settings (canonical names from the CSS engine) are
 * renamed per widget by SETTING_ADAPTERS — e.g. `color` becomes
 * `title_color` on a heading but `button_text_color` on a button — and
 * responsive variants get `_tablet` / `_mobile` suffixes.
 */

import { BREAKPOINTS, DEVICE_SUFFIX, EL_TYPES, MAPPING_SOURCES } from '../../common/constants.js';
import { compactObject, escapeHtml } from '../../common/utils.js';
import { elementorId } from '../../common/utils.js';

/* ------------------------------------------------------------------ *
 * Widget setting adapters
 * Each receives (node) and returns widget-specific *content* settings.
 * Style settings flow through styleSettingsFor() + renames.
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

/** Renames from canonical style-setting names to widget-specific ones. */
const STYLE_RENAMES = {
  heading: { color: 'title_color' },
  'text-editor': { color: 'text_color' },
  button: { color: 'button_text_color', padding: 'text_padding' },
  icon: { color: 'primary_color' },
  'icon-list': { color: 'icon_color' },
  divider: { color: 'color' },
};

/** Style keys that make no sense on widgets and must stay container-only. */
const CONTAINER_ONLY_KEYS = new Set([
  'flex_direction', 'flex_wrap', 'flex_justify_content', 'flex_align_items',
  'flex_gap', 'min_height',
]);

/** On widgets, generic box styles move to the Advanced tab (underscore-prefixed). */
const WIDGET_ADVANCED_PREFIX = new Set(['margin', 'padding', 'z_index', 'position']);

/* ------------------------------------------------------------------ *
 * Tree conversion
 * ------------------------------------------------------------------ */

/**
 * @param {object} snapshot IR snapshot
 * @param {object} [options] { title, type: 'page'|'section'|'container' }
 * @returns {object} Elementor template JSON (importable .json file content)
 */
export function exportElementorTemplate(snapshot, options = {}) {
  const ctx = {
    assetsById: new Map((snapshot.assets ?? []).map((a) => [a.id, a])),
  };
  // Full-page scope: <body> is just a host, its children become the
  // template's top-level containers. Element scope: the picked element IS
  // the design (its flex/min-height/background settings must survive), so it
  // exports as the single root container — matching how Elementor exports a
  // section/container template (type "container").
  const isElementScope = snapshot.meta?.scope === 'element';
  const rootChildren = visibleChildren(snapshot.tree);
  const content = (isElementScope || !rootChildren.length)
    ? [convertNode(snapshot.tree, ctx, false)].filter(Boolean)
    : rootChildren.map((n) => convertNode(n, ctx, false)).filter(Boolean);

  return {
    content,
    page_settings: buildPageSettings(snapshot),
    version: '0.4',
    title: options.title || snapshot.meta.title || 'Imported page',
    type: options.type || (isElementScope ? 'container' : 'page'),
  };
}

function visibleChildren(node) {
  return (node?.children ?? []).filter((c) => !c.hidden);
}

function convertNode(node, ctx, isInner) {
  if (!node || node.hidden || !node.mapping) return null;
  const { elType, widgetType } = node.mapping;

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

  const contentSettings = adapter ? adapter(node, ctx) : defaultWidgetContent(node);
  // Native data-settings (JS-driven config: background_background, _position,
  // menu layout, swiper options) are authoritative — overlay them last.
  const settings = withCommon(node, {
    ...contentSettings,
    ...widgetStyleSettings(node, widgetType),
    ...nativeSettings(node),
  });
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
  if (children.length && isNestedWidget(widgetType)) {
    const slides = nativeChildContainers(node);
    element.elements = (slides.length ? slides : children)
      .map((c) => convertNode(c, ctx, true)).filter(Boolean);
  }
  return element;
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
  return {
    id: node.id,
    settings: compactObject(withCommon(node, { ...containerSettings(node), ...nativeSettings(node) })),
    elements: visibleChildren(node).map((c) => convertNode(c, ctx, true)).filter(Boolean),
    isInner,
    elType: 'container',
  };
}

/** Original Elementor data-settings for native elements (sparse, frontend-only). */
function nativeSettings(node) {
  return node.semantic.elementorNative?.settings ?? {};
}

/** Settings every element type shares: preserved custom CSS classes. */
function withCommon(node, settings) {
  const classes = (node.customClasses ?? []).join(' ').trim();
  if (classes && !settings._css_classes) settings._css_classes = classes;
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
  return ['nested-tabs', 'nested-accordion', 'nested-carousel'].includes(widgetType);
}

function containerSettings(node) {
  const out = {};
  for (const device of [BREAKPOINTS.DESKTOP, BREAKPOINTS.TABLET, BREAKPOINTS.MOBILE]) {
    const suffix = DEVICE_SUFFIX[device];
    const src = node.settings[device] ?? {};
    for (const [key, value] of Object.entries(src)) {
      if (key === 'color' || key === 'align' || key.startsWith('typography_')) continue; // text styles belong to widgets
      out[suffixKey(key, suffix)] = value;
    }
  }
  // Containers sized by the source page: preserve percentage-ish widths.
  const w = node.styles.desktop?.width;
  if (w && w.endsWith('%')) out.width = { unit: '%', size: parseFloat(w), sizes: [] };
  return compactObject(out);
}

function widgetStyleSettings(node, widgetType) {
  const renames = STYLE_RENAMES[widgetType] ?? {};
  const out = {};
  for (const device of [BREAKPOINTS.DESKTOP, BREAKPOINTS.TABLET, BREAKPOINTS.MOBILE]) {
    const suffix = DEVICE_SUFFIX[device];
    const src = node.settings[device] ?? {};
    for (let [key, value] of Object.entries(src)) {
      // A wrapper div that becomes a widget had its width interpreted as a
      // container width; on a widget that is the element-width control.
      if (key === 'width' && value?.unit === '%') {
        out[suffixKey('_element_width', suffix)] = 'initial';
        out[suffixKey('_element_custom_width', suffix)] = value;
        continue;
      }
      if (key === 'content_width') continue; // container-only
      if (CONTAINER_ONLY_KEYS.has(key)) continue;
      if (renames[key]) key = renames[key];
      else if (key === 'color') key = widgetType === 'button' ? 'button_text_color' : 'color';
      else if (WIDGET_ADVANCED_PREFIX.has(key.replace(/^_/, ''))) key = key.startsWith('_') ? key : `_${key}`;
      out[suffixKey(key, suffix)] = value;
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

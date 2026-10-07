/**
 * Content settings of classic Elementor widgets, read back through each
 * widget's render() template (elementor/includes/widgets/*.php,
 * elementor-pro/modules/<m>/widgets/*.php).
 *
 * The generic content engine guesses from tags; on a native widget the
 * markup is fully determined by the template, so the exact setting values —
 * heading tag, link, icon library/value, repeater item `_id`s (which the
 * per-item CSS `.elementor-repeater-item-<id>` refers to) — can be read back.
 */

import { parseInert } from '../../common/safe-html.js';

/** @returns {object|null} content settings, or null for an unhandled widget */
export function extractNativeContent(el, widgetType, baseUrl) {
  const root = el.querySelector(':scope > .elementor-widget-container') ?? el;
  const reader = READERS[widgetType];
  if (!reader) return null;
  let content;
  try {
    content = reader(root, { el, baseUrl });
  } catch {
    return null;
  }
  if (!content) return null;
  // `hover_animation` renders as an `elementor-animation-<name>` class on
  // the animated element (image, button, icon, box icon, social icon).
  if (HOVER_ANIMATED.has(widgetType)) {
    const animated = root.querySelector('[class*="elementor-animation-"]');
    const name = animated && classSuffix(animated, 'elementor-animation-');
    if (name) content.hover_animation = name;
  }
  return content;
}

const HOVER_ANIMATED = new Set(['image', 'button', 'icon', 'icon-box', 'image-box', 'social-icons', 'theme-site-logo']);

/** Every uploaded-SVG icon value inside a content object (nested repeaters too). */
export function uploadedSvgIcons(content) {
  const out = [];
  (function walk(v) {
    if (!v || typeof v !== 'object') return;
    if (v.library === 'svg' && typeof v.__svg === 'string') { out.push(v); return; }
    for (const x of Array.isArray(v) ? v : Object.values(v)) walk(x);
  })(content);
  return out;
}

const READERS = {
  heading(root, ctx) {
    const title = root.querySelector('.elementor-heading-title');
    if (!title) return null;
    const a = title.querySelector(':scope > a');
    return {
      title: (a ?? title).innerHTML.trim(),
      header_size: title.tagName.toLowerCase(),
      ...(a ? { link: link(a, ctx.baseUrl) } : {}),
    };
  },

  'text-editor'(root) {
    return { editor: cleanHtml(root.innerHTML) };
  },

  html(root) {
    return { html: root.innerHTML.trim() };
  },

  button(root, ctx) {
    const a = root.querySelector('.elementor-button');
    if (!a) return null;
    const out = { text: textOf(a.querySelector('.elementor-button-text')) };
    if (a.tagName === 'A' && a.getAttribute('href')) out.link = link(a, ctx.baseUrl);
    const size = classSuffix(a, 'elementor-size-');
    if (size) out.size = size;
    const icon = a.querySelector('.elementor-button-icon');
    if (icon) Object.assign(out, { selected_icon: iconOf(icon) });
    if (a.id) out.button_css_id = a.id;
    return out;
  },

  image(root, ctx) {
    const img = root.querySelector('img');
    if (!img) return null;
    const a = img.closest('a');
    const caption = root.querySelector('figcaption');
    // wp_get_attachment_image() marks the registered size: `size-medium`.
    const size = classSuffix(img, 'size-');
    return {
      image: imageValue(img, ctx.baseUrl),
      ...(size && size !== 'full' ? { image_size: size } : {}),
      ...(a && root.contains(a) ? { link_to: 'custom', link: link(a, ctx.baseUrl) } : {}),
      ...(caption ? { caption_source: 'custom', caption: textOf(caption) } : {}),
    };
  },

  icon(root, ctx) {
    const box = root.querySelector('.elementor-icon');
    if (!box) return null;
    return {
      selected_icon: iconOf(box),
      ...(box.tagName === 'A' ? { link: link(box, ctx.baseUrl) } : {}),
    };
  },

  'icon-box'(root, ctx) {
    const iconBox = root.querySelector('.elementor-icon-box-icon .elementor-icon');
    const title = root.querySelector('.elementor-icon-box-title');
    const desc = root.querySelector('.elementor-icon-box-description');
    const a = root.querySelector('.elementor-icon-box-title a, .elementor-icon-box-icon a');
    return {
      selected_icon: iconBox ? iconOf(iconBox) : { value: '', library: '' },
      title_text: title ? textHtml(title.querySelector(':scope > a, :scope > span') ?? title) : '',
      description_text: desc ? desc.innerHTML.trim() : '',
      ...(title ? { title_size: title.tagName.toLowerCase() } : {}),
      ...(a ? { link: link(a, ctx.baseUrl) } : {}),
    };
  },

  'image-box'(root, ctx) {
    const img = root.querySelector('.elementor-image-box-img img');
    const title = root.querySelector('.elementor-image-box-title');
    const desc = root.querySelector('.elementor-image-box-description');
    const a = root.querySelector('.elementor-image-box-title a, .elementor-image-box-img a');
    return {
      ...(img ? { image: imageValue(img, ctx.baseUrl) } : {}),
      title_text: title ? textHtml(title.querySelector(':scope > a') ?? title) : '',
      description_text: desc ? desc.innerHTML.trim() : '',
      ...(title ? { title_size: title.tagName.toLowerCase() } : {}),
      ...(a ? { link: link(a, ctx.baseUrl) } : {}),
    };
  },

  'icon-list'(root, ctx) {
    const items = [...root.querySelectorAll('.elementor-icon-list-item')].map((li) => {
      const a = li.querySelector(':scope > a');
      const icon = li.querySelector('.elementor-icon-list-icon');
      const item = {
        text: textHtml(li.querySelector('.elementor-icon-list-text') ?? li),
        selected_icon: icon ? iconOf(icon) : { value: '', library: '' },
        _id: repeaterId(li) ?? randomId(),
      };
      if (a) item.link = link(a, ctx.baseUrl);
      return item;
    });
    return { icon_list: items };
  },

  'social-icons'(root, ctx) {
    const items = [...root.querySelectorAll('.elementor-social-icon')].map((a) => {
      const item = {
        social_icon: iconOf(a),
        _id: repeaterId(a) ?? randomId(),
      };
      if (a.getAttribute('href')) item.link = link(a, ctx.baseUrl);
      return item;
    });
    return { social_icon_list: items };
  },

  counter(root) {
    const num = root.querySelector('.elementor-counter-number');
    if (!num) return null;
    const out = {
      starting_number: Number(num.getAttribute('data-from-value') ?? 0),
      ending_number: Number(num.getAttribute('data-to-value') ?? textOf(num)),
      prefix: textOf(root.querySelector('.elementor-counter-number-prefix')),
      suffix: textOf(root.querySelector('.elementor-counter-number-suffix')),
      title: textOf(root.querySelector('.elementor-counter-title')),
    };
    const delimiter = num.getAttribute('data-delimiter');
    if (delimiter) out.thousand_separator_char = delimiter;
    return out;
  },

  progress(root) {
    const bar = root.querySelector('.elementor-progress-bar');
    const title = root.querySelector('.elementor-title');
    const inner = root.querySelector('.elementor-progress-text');
    const max = Number(bar?.getAttribute('data-max') ?? NaN);
    return {
      title: textOf(title),
      ...(Number.isFinite(max) ? { percent: { unit: '%', size: max, sizes: [] } } : {}),
      inner_text: textOf(inner),
    };
  },

  testimonial(root, ctx) {
    const img = root.querySelector('.elementor-testimonial-image img');
    return {
      testimonial_content: (root.querySelector('.elementor-testimonial-content')?.innerHTML ?? '').trim(),
      testimonial_name: textOf(root.querySelector('.elementor-testimonial-name')),
      testimonial_job: textOf(root.querySelector('.elementor-testimonial-job')),
      ...(img ? { testimonial_image: imageValue(img, ctx.baseUrl) } : {}),
    };
  },

  divider(root) {
    const text = root.querySelector('.elementor-divider__text');
    return text ? { look: 'line_text', text: textOf(text) } : {};
  },

  'star-rating'(root) {
    const rating = root.querySelector('.elementor-star-rating');
    const title = root.querySelector('.elementor-star-rating__title');
    const m = /([\d.]+)\s*\/\s*([\d.]+)/.exec(rating?.getAttribute('title') ?? '');
    return {
      ...(m ? { rating: Number(m[1]), rating_scale: m[2] } : {}),
      ...(title ? { title: textOf(title) } : {}),
    };
  },

  'theme-site-logo'(root, ctx) {
    const img = root.querySelector('img');
    return img ? { image: imageValue(img, ctx.baseUrl) } : null;
  },
};
READERS['theme-site-title'] = READERS.heading;
READERS['theme-page-title'] = READERS.heading;
READERS['theme-post-title'] = READERS.heading;

/* ------------------------------------------------------------------ */

/**
 * Icon control value from rendered markup:
 *  - Font Awesome as inline SVG (e_font_icon_svg): `<svg class="e-font-icon-svg e-fas-user">`
 *  - icon font: `<i class="fas fa-user">`
 *  - uploaded SVG: plain `<svg>` -> library "svg" (file URL not in the markup)
 */
export function iconOf(container) {
  const svg = container.querySelector('svg');
  const svgFa = svg && [...svg.classList].find((c) => /^e-(fas|far|fab)-/.test(c));
  if (svgFa) {
    const [, style, name] = /^e-(fas|far|fab)-(.+)$/.exec(svgFa);
    return { value: `${style} fa-${name}`, library: FA_LIBRARY[style] };
  }
  const i = container.querySelector('i[class]');
  if (i) {
    const cls = i.getAttribute('class').trim();
    const style = /\b(fas|far|fab|fa-solid|fa-regular|fa-brands)\b/.exec(cls)?.[1];
    if (style) return { value: cls.replace(/\s*aria-hidden\S*/g, ''), library: FA_LIBRARY[style] ?? 'fa-solid' };
    const eicon = /\beicon-[\w-]+/.exec(cls)?.[0];
    if (eicon) return { value: eicon, library: 'eicons' };
    return { value: cls, library: '' };
  }
  // Uploaded SVG: the file URL is recovered later (svg-resolver.js) from the
  // inline drawing carried here under a temporary key.
  if (svg) return { value: { url: '', id: '' }, library: 'svg', __svg: svg.outerHTML };
  return { value: '', library: '' };
}

const FA_LIBRARY = {
  fas: 'fa-solid', 'fa-solid': 'fa-solid',
  far: 'fa-regular', 'fa-regular': 'fa-regular',
  fab: 'fa-brands', 'fa-brands': 'fa-brands',
};

function imageValue(img, baseUrl) {
  const src = img.getAttribute('data-src') || img.getAttribute('data-lazy-src') || img.currentSrc || img.getAttribute('src') || '';
  // Attachment ids are site-specific: on the import target the same id can
  // be a different file, so the export references images by URL only.
  return {
    url: absolute(src, baseUrl),
    id: '',
    alt: img.getAttribute('alt') ?? '',
    source: 'library',
    size: '',
  };
}

function link(a, baseUrl) {
  const out = {
    url: absolute(a.getAttribute('href') || '', baseUrl),
    is_external: a.getAttribute('target') === '_blank' ? 'on' : '',
    nofollow: /\bnofollow\b/.test(a.getAttribute('rel') || '') ? 'on' : '',
    custom_attributes: '',
  };
  return out;
}

function absolute(url, baseUrl) {
  if (!url || /^(#|mailto:|tel:|javascript:)/i.test(url)) return url;
  try { return new URL(url, baseUrl).href; } catch { return url; }
}

function repeaterId(el) {
  return /\belementor-repeater-item-([0-9a-z]+)\b/.exec(el.getAttribute('class') || '')?.[1] ?? null;
}

function classSuffix(el, prefix) {
  return [...el.classList].find((c) => c.startsWith(prefix))?.slice(prefix.length) ?? null;
}

function textOf(el) {
  return (el?.textContent ?? '').replace(/\s+/g, ' ').trim();
}

/** Inner HTML for text fields that accept inline markup (wp_kses_post). */
function textHtml(el) {
  return el.innerHTML.replace(/\s+/g, ' ').trim();
}

/** Editor HTML minus anything executable. */
function cleanHtml(html) {
  const root = parseInert(html); // scripts, handlers, javascript: URLs removed
  for (const n of root.querySelectorAll('style')) n.remove();
  return root.innerHTML.trim();
}

function randomId() {
  return Math.random().toString(16).slice(2, 9);
}

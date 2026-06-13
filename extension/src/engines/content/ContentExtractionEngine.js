/**
 * Content Extraction Engine
 * -------------------------
 * Phase 2. Pulls the *content* out of each IR node: text, rich HTML, links,
 * button labels, form field definitions, menu trees, media references and
 * dynamic-content placeholders (WordPress shortcodes, template moustaches).
 *
 * Content lives in `node.content` and is deliberately separate from styling
 * so the builder can edit text without touching settings.
 */

import { LIMITS, NODE_ROLES } from '../../common/constants.js';
import { resolveUrl, truncate, walkTree } from '../../common/utils.js';
import { bestImageUrl } from '../assets/image-utils.js';
import { isRichTextBlock } from '../dom/structure-heuristics.js';

const HEADING_TAGS = new Set(['h1', 'h2', 'h3', 'h4', 'h5', 'h6']);
const DYNAMIC_PATTERNS = [
  /\[[\w-]+(?:\s[^\]]*)?\]/,          // WordPress shortcode [gallery ids="1,2"]
  /\{\{[^}]+\}\}/,                    // moustache/Twig {{ post.title }}
  /\{%[^%]+%\}/,                      // Twig statements
  /<%[\s\S]*?%>/,                     // EJS/ASP
];

export class ContentExtractionEngine {
  static phaseName = 'content-extraction';

  run(ctx) {
    const { snapshot, logger } = ctx;
    const log = logger.child('content');
    const elements = ctx.scratch.get('elementsByNodeId');
    if (!elements || !snapshot.tree) return;
    const baseUrl = snapshot.meta.url;
    let extracted = 0;

    walkTree(snapshot.tree, (node) => {
      const el = elements.get(node.id);
      if (!el) return;
      const c = node.content;
      const tag = node.tag;

      // --- Headings & plain text widgets --------------------------------
      if (HEADING_TAGS.has(tag)) {
        c.text = cleanText(el.textContent);
        c.headerSize = tag;
      } else if (node.role === NODE_ROLES.WIDGET && (tag === 'p' || tag === 'span' || tag === 'div' || tag === 'blockquote' || tag === 'li' || tag === 'label')) {
        if (isRichTextBlock(el) || tag === 'p' || tag === 'blockquote') {
          c.html = sanitizeRichHtml(el.innerHTML);
        }
        c.text = cleanText(el.textContent);
      }

      // --- Links & buttons -------------------------------------------------
      if (tag === 'a') {
        c.text = c.text ?? cleanText(el.textContent);
        c.href = resolveUrl(el.getAttribute('href'), baseUrl) || el.getAttribute('href') || '';
        c.target = el.getAttribute('target') || '';
        c.rel = el.getAttribute('rel') || '';
        c.isButtonLike = isButtonLike(el, ctx.window.getComputedStyle(el));
      }
      if (tag === 'button' || (tag === 'input' && ['submit', 'button'].includes(el.type))) {
        c.text = cleanText(el.textContent || el.value || '');
        c.isButtonLike = true;
      }

      // --- Media ------------------------------------------------------------
      if (tag === 'img' || tag === 'picture') {
        const img = tag === 'picture' ? (el.querySelector('img') ?? el) : el;
        c.src = bestImageUrl(el, baseUrl);
        c.alt = img.getAttribute('alt') || '';
        c.title = img.getAttribute('title') || '';
        const link = el.closest('a');
        if (link) c.linkHref = resolveUrl(link.getAttribute('href'), baseUrl);
      }
      if (tag === 'video') {
        c.src = resolveUrl(el.getAttribute('src') || el.querySelector('source')?.getAttribute('src'), baseUrl);
        c.poster = resolveUrl(el.getAttribute('poster'), baseUrl);
        c.autoplay = el.hasAttribute('autoplay');
        c.loop = el.hasAttribute('loop');
        c.muted = el.hasAttribute('muted');
      }
      if (tag === 'iframe') {
        c.src = el.getAttribute('src') || '';
        c.videoProvider = /youtube/.test(c.src) ? 'youtube' : /vimeo/.test(c.src) ? 'vimeo' : /maps\.google|google\.[a-z.]+\/maps/.test(c.src) ? 'google-maps' : null;
      }
      if (tag === 'svg') c.svgMarkup = truncate(el.outerHTML, LIMITS.MAX_INLINE_SVG_BYTES);

      // --- Forms --------------------------------------------------------------
      if (tag === 'form') {
        c.action = el.getAttribute('action') || '';
        c.method = (el.getAttribute('method') || 'get').toLowerCase();
        c.fields = extractFormFields(el);
      }

      // --- Menus ----------------------------------------------------------------
      if (tag === 'nav' || (node.semantic.kind === 'nav' && (tag === 'ul' || tag === 'div'))) {
        const list = tag === 'ul' ? el : el.querySelector('ul');
        if (list) c.menu = extractMenu(list, baseUrl, 0);
      }
      if (tag === 'ul' || tag === 'ol') {
        const items = [...el.children].filter((li) => li.tagName === 'LI');
        if (items.length && items.every((li) => !li.querySelector('ul, ol, div, section'))) {
          c.listItems = items.slice(0, 100).map((li) => ({
            text: cleanText(li.textContent),
            href: resolveUrl(li.querySelector('a')?.getAttribute('href'), baseUrl),
          }));
        }
      }

      // --- Dynamic content placeholders ---------------------------------------
      const ownText = directText(el);
      if (ownText && DYNAMIC_PATTERNS.some((re) => re.test(ownText))) {
        c.dynamicPlaceholder = truncate(ownText, 400);
        node.warnings.push('Contains a dynamic-content placeholder; map it to an Elementor dynamic tag after import.');
      }

      if (Object.keys(c).length) extracted++;
      if (c.text) c.text = truncate(c.text, LIMITS.MAX_TEXT_LENGTH);
      if (c.html) c.html = truncate(c.html, LIMITS.MAX_TEXT_LENGTH);
    });

    log.info(`content extracted for ${extracted} nodes`);
  }
}

function cleanText(text) {
  return (text || '').replace(/\s+/g, ' ').trim();
}

/** Keep semantic inline markup, strip everything risky or styling-only. */
function sanitizeRichHtml(html) {
  const tpl = document.createElement('template');
  tpl.innerHTML = html;
  const ALLOWED = new Set(['P', 'BR', 'B', 'STRONG', 'I', 'EM', 'U', 'S', 'A', 'SPAN', 'UL', 'OL', 'LI', 'SUB', 'SUP', 'MARK', 'SMALL', 'CODE']);
  const walk = (parent) => {
    for (const child of [...parent.children]) {
      walk(child);
      if (!ALLOWED.has(child.tagName)) {
        child.replaceWith(...child.childNodes);
        continue;
      }
      for (const attr of [...child.attributes]) {
        if (child.tagName === 'A' && (attr.name === 'href' || attr.name === 'target')) continue;
        child.removeAttribute(attr.name);
      }
    }
  };
  walk(tpl.content);
  return tpl.innerHTML.trim();
}

function isButtonLike(el, style) {
  const cls = (el.getAttribute('class') || '').toLowerCase();
  if (/\b(btn|button|cta|elementor-button)\b/.test(cls)) return true;
  if (el.getAttribute('role') === 'button') return true;
  const hasBg = style.backgroundColor && style.backgroundColor !== 'rgba(0, 0, 0, 0)';
  const hasBorder = style.borderTopStyle !== 'none' && parseFloat(style.borderTopWidth) > 0;
  const hasPadding = parseFloat(style.paddingLeft) >= 8 && parseFloat(style.paddingTop) >= 4;
  return (hasBg || hasBorder) && hasPadding && (style.display.includes('inline') || style.display.includes('flex'));
}

function extractFormFields(formEl) {
  const fields = [];
  for (const input of formEl.querySelectorAll('input, textarea, select')) {
    const type = input.tagName === 'TEXTAREA' ? 'textarea' : input.tagName === 'SELECT' ? 'select' : (input.type || 'text');
    if (type === 'hidden') continue;
    const field = {
      type,
      name: input.getAttribute('name') || '',
      label: labelFor(formEl, input),
      placeholder: input.getAttribute('placeholder') || '',
      required: input.hasAttribute('required'),
    };
    if (type === 'select') {
      field.options = [...input.querySelectorAll('option')].slice(0, 50).map((o) => cleanText(o.textContent));
    }
    fields.push(field);
    if (fields.length >= 40) break;
  }
  return fields;
}

function labelFor(formEl, input) {
  const id = input.getAttribute('id');
  if (id) {
    const label = formEl.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label) return cleanText(label.textContent);
  }
  const wrapping = input.closest('label');
  return wrapping ? cleanText(wrapping.textContent) : '';
}

function extractMenu(listEl, baseUrl, depth) {
  if (depth > 3) return [];
  const items = [];
  for (const li of listEl.children) {
    if (li.tagName !== 'LI') continue;
    const a = li.querySelector(':scope > a');
    const item = {
      text: cleanText(a?.textContent || li.firstChild?.textContent || ''),
      href: resolveUrl(a?.getAttribute('href'), baseUrl) || '',
    };
    const sub = li.querySelector(':scope > ul, :scope > .sub-menu ul, :scope > div ul');
    if (sub) item.children = extractMenu(sub, baseUrl, depth + 1);
    if (item.text) items.push(item);
    if (items.length >= 50) break;
  }
  return items;
}

/** Text directly inside the element (not from descendants). */
function directText(el) {
  let out = '';
  for (const child of el.childNodes) {
    if (child.nodeType === 3) out += child.nodeValue;
  }
  return out.trim();
}

/**
 * Asset Collection Engine
 * -----------------------
 * Phase 5. Builds a deduplicated catalog of every asset the page uses:
 * images (src + srcset), inline SVGs, icon-font glyphs, videos (+posters),
 * web fonts (@font-face) and CSS background images/overlays. Nodes reference
 * assets by id, so replacing an image in the builder is a catalog operation.
 *
 * Binary download happens later in the Export Engine (assets package);
 * here we only catalog identity + metadata, keeping extraction fast.
 */

import { LIMITS } from '../../common/constants.js';
import { fileExtensionFromUrl, resolveUrl, truncate, walkTree } from '../../common/utils.js';
import { assetId, createAsset } from '../../core/model.js';
import { extractCssUrl } from '../css/converters.js';
import { bestImageUrl, srcsetUrls } from './image-utils.js';

const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'avif', 'bmp', 'ico']);
const ICON_FONT_CLASS = /(^|\s)(fa[srlbd]?|fa-[\w-]+|eicon-[\w-]+|icon-[\w-]+|material-icons|dashicons(-[\w-]+)?)(\s|$)/;

export class AssetCollectionEngine {
  static phaseName = 'asset-collection';

  async run(ctx) {
    const { snapshot, document, logger } = ctx;
    const log = logger.child('assets');
    const elements = ctx.scratch.get('elementsByNodeId');
    if (!elements || !snapshot.tree) return;

    const baseUrl = snapshot.meta.url || document.baseURI;
    const catalog = new Map(); // assetId -> asset

    const register = (init, nodeId) => {
      if (catalog.size >= LIMITS.MAX_ASSETS) return null;
      const identity = init.url || `inline:${init.inline?.slice(0, 256)}`;
      if (!identity) return null;
      const id = assetId(`${init.type}:${identity}`);
      let asset = catalog.get(id);
      if (!asset) {
        asset = createAsset({ ...init, id });
        if (asset.url) {
          try {
            const u = new URL(asset.url);
            asset.origin = u.host;
            asset.filename = decodeURIComponent(u.pathname.split('/').pop() || '') || `${id}.${fileExtensionFromUrl(asset.url) || 'bin'}`;
          } catch { /* keep defaults */ }
        }
        catalog.set(id, asset);
      }
      if (nodeId && !asset.usedBy.includes(nodeId)) asset.usedBy.push(nodeId);
      return asset;
    };

    walkTree(snapshot.tree, (node) => {
      const el = elements.get(node.id);
      if (!el) return;
      const tag = node.tag;

      // <img> + srcset + <picture> sources -------------------------------
      if (tag === 'img' || tag === 'picture') {
        const img = tag === 'picture' ? (el.querySelector('img') ?? el) : el;
        const src = bestImageUrl(el, baseUrl);
        if (src) {
          const a = register({
            type: 'image', url: src,
            meta: {
              alt: img.getAttribute('alt') || '',
              width: img.naturalWidth || null,
              height: img.naturalHeight || null,
              loading: img.getAttribute('loading') || '',
            },
          }, node.id);
          if (a) node.assets.push(a.id);
        }
        const srcset = img.getAttribute('srcset') || img.getAttribute('data-srcset');
        for (const u of srcsetUrls(srcset, baseUrl)) {
          if (u !== src) register({ type: 'image', url: u, meta: { variantOf: src } }, node.id);
        }
      }

      // inline <svg> -------------------------------------------------------
      if (tag === 'svg') {
        const markup = el.outerHTML;
        if (markup && markup.length <= LIMITS.MAX_INLINE_SVG_BYTES) {
          const a = register({
            type: 'svg', inline: markup, mime: 'image/svg+xml',
            filename: `inline-${node.id}.svg`,
            meta: { viewBox: el.getAttribute('viewBox') || '' },
          }, node.id);
          if (a) node.assets.push(a.id);
        }
      }

      // icon-font glyphs (<i class="fa-...">) -------------------------------
      if ((tag === 'i' || tag === 'span') && !el.childElementCount) {
        const cls = el.getAttribute('class') || '';
        if (ICON_FONT_CLASS.test(cls)) {
          const a = register({
            type: 'icon', url: null, inline: cls,
            filename: `icon-${node.id}.txt`,
            meta: { classes: cls, library: iconLibrary(cls) },
          }, node.id);
          if (a) node.assets.push(a.id);
        }
      }

      // <video> + poster, child <source> ------------------------------------
      if (tag === 'video') {
        const src = resolveUrl(el.getAttribute('src') || el.querySelector('source')?.getAttribute('src'), baseUrl);
        if (src) {
          const a = register({ type: 'video', url: src, meta: { poster: resolveUrl(el.getAttribute('poster'), baseUrl) } }, node.id);
          if (a) node.assets.push(a.id);
        }
        const poster = resolveUrl(el.getAttribute('poster'), baseUrl);
        if (poster) register({ type: 'image', url: poster, meta: { role: 'poster' } }, node.id);
      }
      if (tag === 'iframe') {
        const src = el.getAttribute('src') || '';
        if (/youtube|vimeo|dailymotion/.test(src)) {
          const a = register({ type: 'video', url: resolveUrl(src, baseUrl), meta: { embed: true } }, node.id);
          if (a) node.assets.push(a.id);
        }
      }

      // CSS backgrounds (desktop + responsive raw styles) ---------------------
      for (const device of ['desktop', 'tablet', 'mobile']) {
        const bg = extractCssUrl(node.styles[device]?.['background-image']);
        const u = resolveUrl(bg, baseUrl);
        if (u && !u.startsWith('data:')) {
          const a = register({ type: 'background', url: u, meta: { device } }, node.id);
          if (a && !node.assets.includes(a.id)) node.assets.push(a.id);
        }
      }
    });

    // Web fonts from the stylesheet index built by the responsive engine.
    // Relative src URLs resolve against the DECLARING stylesheet — resolving
    // against the page URL 404s every theme font served from /wp-content/....
    const sheetIndex = ctx.scratch.get('stylesheetIndex');
    const registerFace = (face) => {
      const srcUrl = resolveUrl(extractCssUrl(face.src), face.baseHref || baseUrl);
      if (!srcUrl || !face.family) return;
      register({
        type: 'font', url: srcUrl,
        meta: { family: face.family, weight: face.weight, style: face.style },
      }, null);
    };
    for (const face of sheetIndex?.fontFaces ?? []) registerFace(face);

    // Cross-origin stylesheets (Google Fonts, CDN theme CSS) hide their rules
    // from CSSOM — without their @font-face the preview falls back to system
    // fonts. Fetch the css text and mine the faces out of it.
    for (const face of await fetchCrossOriginFontFaces(sheetIndex?.inaccessibleHrefs ?? [], log)) {
      registerFace(face);
    }

    // Favicon — useful in the assets package.
    const iconLink = document.querySelector('link[rel~="icon"]');
    if (iconLink) {
      const u = resolveUrl(iconLink.getAttribute('href'), baseUrl);
      if (u) register({ type: 'favicon', url: u }, null);
    }

    snapshot.assets = [...catalog.values()].map((a) => ({
      ...a,
      inline: a.inline ? truncate(a.inline, LIMITS.MAX_INLINE_SVG_BYTES) : null,
    }));
    snapshot.stats.assetsCollected = snapshot.assets.length;
    log.info(`cataloged ${snapshot.assets.length} assets`);
  }
}

const FONT_FETCH_LIMIT = 12;
const FONT_FETCH_TIMEOUT = 4000;

/** Fetch cross-origin css text and regex-mine its @font-face blocks. */
async function fetchCrossOriginFontFaces(hrefs, log) {
  const faces = [];
  const targets = hrefs.slice(0, FONT_FETCH_LIMIT);
  await Promise.allSettled(targets.map(async (href) => {
    const css = await fetchText(href);
    if (!css) return;
    for (const block of css.match(/@font-face\s*\{[^}]*\}/g) ?? []) {
      const prop = (name) => new RegExp(`${name}\\s*:\\s*([^;}]+)`, 'i').exec(block)?.[1].trim() ?? '';
      const family = prop('font-family').replace(/^['"]|['"]$/g, '');
      const src = prop('src');
      if (!family || !src) continue;
      faces.push({
        family, src,
        weight: prop('font-weight') || 'normal',
        style: prop('font-style') || 'normal',
        baseHref: href,
      });
    }
  }));
  if (faces.length) log.info(`recovered ${faces.length} @font-face rule(s) from cross-origin css`);
  return faces;
}

async function fetchText(url) {
  try {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FONT_FETCH_TIMEOUT);
    const res = await fetch(url, { signal: controller.signal, credentials: 'omit' });
    clearTimeout(timer);
    if (!res.ok || !/text\/css|text\/plain/.test(res.headers.get('content-type') ?? 'text/css')) return null;
    return await res.text();
  } catch { return null; }
}

function iconLibrary(cls) {
  if (/\bfa[srlbd]?\b|fa-/.test(cls)) return 'fa-solid';
  if (/eicon-/.test(cls)) return 'eicons';
  if (/dashicons/.test(cls)) return 'dashicons';
  if (/material-icons/.test(cls)) return 'material';
  return 'custom';
}

/** Validate an image-ish URL extension (used by builder image replacement). */
export function looksLikeImageUrl(url) {
  const ext = fileExtensionFromUrl(url);
  return !ext || IMAGE_EXTS.has(ext) || ext === 'svg';
}

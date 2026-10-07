/**
 * Uploaded SVG icon recovery.
 *
 * Elementor renders an icon whose library is "svg" by inlining the uploaded
 * file (Icons_Manager::render_uploaded_svg_icon -> Svg_Handler::get_inline_svg
 * by attachment id), so the page carries the drawing but not the file URL.
 * Without the URL the exported icon is empty; with it, Elementor's template
 * import downloads the file itself (controls/icons.php::on_import).
 *
 * The URL is recovered from the source site's public media endpoint
 * (/wp-json/wp/v2/media?mime_type=image/svg+xml). Elementor stores each SVG's
 * width/height in the attachment metadata (core/files/file-types/svg.php::
 * set_svg_meta_data: width attribute, else viewBox), so candidates are
 * narrowed by dimensions and ranked by file size before any file is fetched;
 * a candidate is accepted when its geometry signature (viewBox + shape
 * attributes, which survive the upload sanitizer) equals the inline drawing's.
 * The request budget stays small so the source site's firewall is not hit.
 */

const MAX_MEDIA_PAGES = 30;          // 3000 SVG attachments
const MAX_FILE_FETCHES = 120;
const MAX_CANDIDATES_PER_ICON = 12;
const CONCURRENCY = 3;
const PAGE_CONCURRENCY = 4;
const REQUEST_TIMEOUT_MS = 20_000;
/** Total time the lookup may add to an extraction. */
const TIME_BUDGET_MS = 40_000;

/**
 * @param {Array<{markup: string, apply: (url: string) => void}>} icons
 * @param {object} opts
 * @param {Document} opts.document source page (REST root discovery)
 * @param {(url: string) => Promise<string|null>} opts.fetchText
 * @returns {Promise<{resolved: number, total: number, scanned: number}>}
 */
export async function resolveUploadedSvgIcons(icons, { document, fetchText }) {
  // Group identical drawings: one lookup serves every use of an icon.
  const groups = new Map();
  for (const icon of icons) {
    const info = svgInfo(icon.markup);
    if (!info) continue;
    if (!groups.has(info.signature)) groups.set(info.signature, { ...info, icons: [] });
    groups.get(info.signature).icons.push(icon);
  }
  const total = icons.length;
  if (!groups.size) return { resolved: 0, total, scanned: 0 };

  const deadline = Date.now() + TIME_BUDGET_MS;
  const restRoot = findRestRoot(document);
  const media = restRoot ? await listSvgMedia(restRoot, fetchText, deadline) : [];
  if (!media.length) return { resolved: 0, total, scanned: 0, timedOut: Date.now() >= deadline };

  // Fetch queue: per drawing, same-dimension attachments closest in size first.
  const queue = [];
  for (const group of groups.values()) {
    const candidates = media
      .filter((m) => m.width === group.width && m.height === group.height)
      .sort((a, b) => Math.abs(a.filesize - group.length) - Math.abs(b.filesize - group.length))
      .slice(0, MAX_CANDIDATES_PER_ICON);
    for (const m of candidates) queue.push({ group, url: m.url });
  }

  const fileSignatures = new Map(); // url -> signature (each file fetched once)
  let resolved = 0;
  let scanned = 0;
  let next = 0;
  const worker = async () => {
    while (next < queue.length && scanned < MAX_FILE_FETCHES && Date.now() < deadline) {
      const { group, url } = queue[next++];
      if (group.done) continue;
      let sig = fileSignatures.get(url);
      if (sig === undefined) {
        scanned++;
        const text = await fetchText(url).catch(() => null);
        sig = text ? svgInfo(text)?.signature ?? null : null;
        fileSignatures.set(url, sig);
      }
      if (sig !== group.signature || group.done) continue;
      group.done = true;
      for (const icon of group.icons) { icon.apply(url); resolved++; }
    }
  };
  await Promise.all(Array.from({ length: CONCURRENCY }, worker));
  return { resolved, total, scanned, timedOut: Date.now() >= deadline };
}

/** WordPress REST root from <link rel="https://api.w.org/">, else /wp-json/. */
function findRestRoot(document) {
  const link = document.querySelector('link[rel="https://api.w.org/"]')?.getAttribute('href');
  if (link) return link.endsWith('/') ? link : `${link}/`;
  try { return new URL('/wp-json/', document.baseURI).href; } catch { return null; }
}

/**
 * All SVG attachments with Elementor's stored dimensions. Page 1 reveals the
 * page count (X-WP-TotalPages), the rest is fetched in parallel; everything
 * stops at the time budget so a slow media endpoint cannot stall extraction.
 */
async function listSvgMedia(restRoot, fetchText, deadline) {
  const out = [];
  const sep = restRoot.includes('?') ? '&' : '?';
  // Some sites ignore the mime filter (security/media plugins) and return
  // every attachment; SVGs are picked out below either way.
  const pageUrl = (page) => `${restRoot}wp/v2/media${sep}mime_type=image/svg%2Bxml&per_page=100&page=${page}&_fields=source_url,mime_type,media_details`;
  const collect = (list) => {
    for (const m of list) {
      if (!m?.source_url) continue;
      if (m.mime_type ? m.mime_type !== 'image/svg+xml' : !/\.svg(\?|$)/i.test(m.source_url)) continue;
      out.push({
        url: m.source_url,
        width: Number(m.media_details?.width) || null,
        height: Number(m.media_details?.height) || null,
        filesize: Number(m.media_details?.filesize) || 0,
      });
    }
  };

  const first = await fetchPage(pageUrl(1), fetchText, deadline);
  if (!Array.isArray(first.list)) return out;
  collect(first.list);

  if (first.totalPages) {
    const pages = [];
    for (let p = 2; p <= Math.min(first.totalPages, MAX_MEDIA_PAGES); p++) pages.push(p);
    let next = 0;
    const worker = async () => {
      while (next < pages.length && Date.now() < deadline) {
        const { list } = await fetchPage(pageUrl(pages[next++]), fetchText, deadline);
        if (Array.isArray(list)) collect(list);
      }
    };
    await Promise.all(Array.from({ length: PAGE_CONCURRENCY }, worker));
    return out;
  }

  // Page count unknown (header hidden): walk until WordPress's error object.
  // No "short page = last page" shortcut — full pages can hold < 100 items
  // when some attachments are not visible to the visitor.
  let failures = 0;
  for (let page = 2; page <= MAX_MEDIA_PAGES && Date.now() < deadline; page++) {
    const { list } = await fetchPage(pageUrl(page), fetchText, deadline);
    if (list === undefined) { if (++failures >= 2) break; continue; }
    if (!Array.isArray(list) || !list.length) break;
    collect(list);
  }
  return out;
}

/**
 * One media page: direct fetch (exposes X-WP-TotalPages), falling back to
 * `fetchText` (service worker) when the page's CORS blocks it. One retry.
 * @returns {Promise<{list?: any, totalPages?: number}>} list undefined = failed
 */
async function fetchPage(url, fetchText, deadline) {
  for (let attempt = 0; attempt < 2 && Date.now() < deadline; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), Math.max(1000, Math.min(REQUEST_TIMEOUT_MS, deadline - Date.now())));
    try {
      const res = await fetch(url, { credentials: 'same-origin', signal: controller.signal });
      // Past the last page WordPress answers 400 rest_post_invalid_page_number.
      if (res.status === 400) return { list: null };
      if (res.ok) return { list: await res.json(), totalPages: Number(res.headers.get('x-wp-totalpages')) || null };
    } catch { /* CORS, timeout or truncated body */ } finally {
      clearTimeout(timer);
    }
    try {
      const text = await fetchText(url);
      if (text) return { list: JSON.parse(text) };
    } catch { /* retry */ }
  }
  return {};
}

const GEOMETRY_ATTRS = ['d', 'points', 'cx', 'cy', 'r', 'rx', 'ry', 'x', 'y', 'x1', 'y1', 'x2', 'y2', 'width', 'height', 'transform'];
const SHAPES = new Set(['path', 'polygon', 'polyline', 'circle', 'ellipse', 'rect', 'line']);

/**
 * Geometry fingerprint + Elementor's metadata dimensions of an SVG document.
 * Styling, ids, metadata and whitespace — what sanitizers and serializers
 * change — are ignored.
 */
export function svgInfo(markup) {
  if (!markup || typeof markup !== 'string') return null;
  let doc;
  try {
    doc = new DOMParser().parseFromString(markup, 'image/svg+xml');
  } catch {
    return null;
  }
  const svg = doc.documentElement;
  if (!svg || svg.nodeName.toLowerCase() !== 'svg') return null;
  const viewBox = (svg.getAttribute('viewBox') ?? '').trim().split(/[\s,]+/);
  const dim = (attr, i) => {
    const m = /\d+/.exec(svg.getAttribute(attr) ?? '');
    if (m) return Number(m[0]);
    return viewBox.length === 4 ? Math.trunc(Number(viewBox[i])) || null : null;
  };
  const parts = [normalizeNumbers(svg.getAttribute('viewBox') ?? '')];
  for (const el of svg.querySelectorAll('*')) {
    const tag = el.nodeName.toLowerCase();
    if (!SHAPES.has(tag)) continue;
    const attrs = GEOMETRY_ATTRS
      .filter((a) => el.hasAttribute(a))
      .map((a) => `${a}=${normalizeNumbers(el.getAttribute(a))}`);
    parts.push(`${tag}(${attrs.join(',')})`);
  }
  if (parts.length < 2) return null;
  return { signature: parts.join('|'), width: dim('width', 2), height: dim('height', 3), length: markup.length };
}

function normalizeNumbers(text) {
  return String(text)
    .replace(/(-?\d*\.?\d+(?:e-?\d+)?)/gi, (n) => String(Math.round(parseFloat(n) * 1000) / 1000))
    .replace(/\s*,\s*/g, ',')
    .replace(/\s+/g, ' ')
    .trim();
}

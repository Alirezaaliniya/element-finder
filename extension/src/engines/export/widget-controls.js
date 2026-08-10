/**
 * Control-name reality map, transcribed from the installed Elementor source
 * (`elementor/includes/widgets/*.php`, `elementor/includes/elements/container.php`,
 * `elementor/includes/controls/groups/*.php`, `elementor-pro/modules/<m>/widgets/*.php`).
 *
 * Why this exists: the CSS engine emits *canonical* setting names (`color`,
 * `padding`, `typography_font_size`, `background_color`…). Elementor does not
 * use one name per concept — the same visual property is a different control
 * on a container, on a widget's Advanced tab, and inside each widget's own
 * Style tab:
 *
 *   concept      container      widget (Advanced)   heading         icon-box
 *   ------------ -------------- ------------------- --------------- ---------------
 *   padding      padding        _padding            _padding        _padding
 *   text colour  — (n/a)        — (n/a)             title_color     title_color
 *   typography   — (n/a)        — (n/a)             typography_*    title_typography_*
 *   background   background_*   _background_*       _background_*   _background_*
 *   position     position       _position           _position       _position
 *   css classes  css_classes    _css_classes        _css_classes    _css_classes
 *
 * A setting written under the wrong name is not an import error — Elementor
 * stores it and never renders it, so the style is silently lost. Every name
 * here is therefore copied from the plugin, not inferred.
 */

/* ------------------------------------------------------------------ *
 * Common controls (present on every element of that type)
 * ------------------------------------------------------------------ */

/** canonical -> container control (container.php). `null` = no such control. */
const CONTAINER_KEYS = {
  padding: 'padding',
  margin: 'margin',
  border_radius: 'border_radius',
  z_index: 'z_index',
  _position: 'position',          // containers dropped the underscore
  overflow: 'overflow',
  min_height: 'min_height',
  width: 'width',
  content_width: 'content_width',
  _css_classes: 'css_classes',    // widgets keep the underscore, containers do not
  _element_width: null,           // widget-only sizing controls
  _element_custom_width: null,
  opacity: null,                  // no opacity control exists on a container
};

/** canonical -> widget Advanced-tab control (common-base.php). */
const WIDGET_KEYS = {
  padding: '_padding',
  margin: '_margin',
  border_radius: '_border_radius',
  z_index: '_z_index',
  _position: '_position',
  _css_classes: '_css_classes',
  overflow: null,                 // layout controls only a container owns
  min_height: null,
  content_width: null,
  opacity: null,
};

/** Common group controls live under `_` on widgets, bare on containers. */
const WIDGET_GROUP_PREFIX = {
  background: '_background',
  border: '_border',
  box_shadow: '_box_shadow',
};

/* ------------------------------------------------------------------ *
 * Per-widget Style-tab naming
 * ------------------------------------------------------------------ */

/**
 * Per widget:
 *   typography  group name for the widget's primary text — fields resolve to
 *               `<group>_typography`, `<group>_font_size`, …
 *               null = the widget owns no text; typography is dropped.
 *   color       control for the primary text colour. null = drop.
 *   align       control for text-align. null = drop.
 *   padding     overrides the Advanced `_padding` where the widget has a
 *               content padding of its own.
 *   background / border / boxShadow / borderRadius
 *               override the common `_`-prefixed groups where the widget
 *               styles its own box (a button styles the <a>, not the wrapper).
 *               An explicit null drops the concept entirely.
 */
export const WIDGET_STYLE_PROFILES = {
  // --- core: basic ---------------------------------------------------------
  heading:        { typography: 'typography', color: 'title_color', align: 'align' },
  'text-editor':  { typography: 'typography', color: 'text_color', align: 'align' },
  image:          { typography: null, color: null, align: 'align', border: 'image_border', borderRadius: 'image_border_radius', boxShadow: 'image_box_shadow' },
  button:         { typography: 'typography', color: 'button_text_color', align: 'align', padding: 'text_padding', background: 'background', border: 'border', borderRadius: 'border_radius', boxShadow: 'button_box_shadow' },
  video:          { typography: null, color: null, align: null },
  divider:        { typography: 'typography', color: 'color', align: 'align' },
  spacer:         { typography: null, color: null, align: null },
  google_maps:    { typography: null, color: null, align: null },
  icon:           { typography: null, color: 'primary_color', align: 'align', borderRadius: 'border_radius' },
  html:           { typography: null, color: null, align: null },
  shortcode:      { typography: null, color: null, align: null },
  'menu-anchor':  { typography: null, color: null, align: null },

  // --- core: general -------------------------------------------------------
  'icon-box':     { typography: 'title_typography', color: 'title_color', align: 'text_align', borderRadius: 'border_radius' },
  'image-box':    { typography: 'title_typography', color: 'title_color', align: 'text_align' },
  'icon-list':    { typography: 'icon_typography', color: 'text_color', align: null },
  'image-carousel': { typography: null, color: null, align: null, borderRadius: 'image_border_radius' },
  'image-gallery': { typography: 'typography', color: 'text_color', align: 'align' },
  counter:        { typography: 'typography_number', color: 'number_color', align: null },
  progress:       { typography: 'typography', color: 'title_color', align: null },
  testimonial:    { typography: 'content_typography', color: 'content_content_color', align: 'testimonial_alignment' },
  tabs:           { typography: 'tab_typography', color: 'tab_color', align: 'title_align' },
  accordion:      { typography: 'title_typography', color: 'title_color', align: null },
  toggle:         { typography: 'title_typography', color: 'title_color', align: null },
  'social-icons': { typography: null, color: 'icon_color', align: 'align', borderRadius: 'border_radius' },
  alert:          { typography: 'alert_title', color: 'title_color', align: null, background: null },
  'star-rating':  { typography: 'title_typography', color: 'title_color', align: 'align' },
  audio:          { typography: null, color: null, align: null },
  'read-more':    { typography: null, color: null, align: null },
  sidebar:        { typography: null, color: null, align: null },

  // --- core: nested elements -----------------------------------------------
  'nested-tabs':  { typography: 'title_typography', color: 'title_text_color', align: 'title_alignment', padding: 'box_padding', borderRadius: 'box_border_radius' },
  'nested-accordion': { typography: 'title_typography', color: null, align: null, padding: 'accordion_padding', borderRadius: 'accordion_border_radius' },

  // --- pro -----------------------------------------------------------------
  'nav-menu':     { typography: 'menu_typography', color: 'color_menu_item', align: 'text_align' },
  'mega-menu':    { typography: null, color: null, align: null },
  form:           { typography: null, color: 'label_color', align: null },
  login:          { typography: null, color: 'label_color', align: null },
  'price-table':  { typography: 'heading_typography', color: 'heading_color', align: null },
  'price-list':   { typography: null, color: 'heading_color', align: null, borderRadius: 'border_radius' },
  'flip-box':     { typography: 'title_typography_a', color: 'title_color_a', align: 'alignment_a', padding: 'padding_a', background: 'background_a', border: 'border_a', borderRadius: 'border_radius' },
  'call-to-action': { typography: 'title_typography', color: 'title_color', align: 'alignment', padding: 'padding' },
  blockquote:     { typography: 'content_typography', color: 'content_text_color', align: 'alignment', padding: 'box_padding', borderRadius: 'box_border_radius' },
  countdown:      { typography: 'digits_typography', color: 'digits_color', align: 'align', padding: 'box_padding', borderRadius: 'box_border_radius' },
  slides:         { typography: 'heading_typography', color: 'heading_color', align: 'text_align' },
  'testimonial-carousel': { typography: null, color: 'content_color', align: 'alignment', borderRadius: 'border_radius' },
  'table-of-contents': { typography: null, color: null, align: null },
  'animated-headline': { typography: null, color: null, align: 'align' },
  lottie:         { typography: null, color: null, align: 'align' },
  'share-buttons': { typography: null, color: null, align: null },
  'progress-tracker': { typography: null, color: null, align: null },
  'loop-grid':    { typography: null, color: null, align: null },
  'loop-carousel': { typography: null, color: null, align: null },
  posts:          { typography: null, color: null, align: null },
  portfolio:      { typography: null, color: null, align: null },
  gallery:        { typography: null, color: null, align: null },
  'search-form':  { typography: null, color: null, align: null },
};

/**
 * Fallback for widgets with no profile (third-party, theme-builder, Woo).
 * `typography` / `color` / `align` are the commonest naming across core
 * widgets, so an unknown widget keeps its text styling instead of losing it.
 */
const DEFAULT_PROFILE = { typography: 'typography', color: 'color', align: 'align' };

export function styleProfile(widgetType) {
  return WIDGET_STYLE_PROFILES[widgetType] ?? DEFAULT_PROFILE;
}

/* ------------------------------------------------------------------ *
 * Responsiveness
 * ------------------------------------------------------------------ */

/**
 * Canonical keys whose Elementor control is NOT registered with
 * add_responsive_control() — writing `title_color_tablet` produces a setting
 * Elementor never reads. Everything absent from this set is responsive.
 */
const NON_RESPONSIVE = new Set([
  'color',
  'typography_typography', 'typography_font_family', 'typography_font_weight',
  'typography_font_style', 'typography_text_transform', 'typography_text_decoration',
  'background_background', 'background_color', 'background_color_b',
  'background_gradient_type',
  'border_border', 'border_color',
  'box_shadow_box_shadow_type', 'box_shadow_box_shadow',
  'content_width', 'overflow', '_position',
  '_offset_orientation_h', '_offset_orientation_v',
  '_css_classes', '_element_id', 'html_tag',
]);

export function isResponsiveKey(canonicalKey) {
  return !NON_RESPONSIVE.has(canonicalKey);
}

/* ------------------------------------------------------------------ *
 * Key resolution
 * ------------------------------------------------------------------ */

/**
 * Translate one canonical setting key into the control name the target
 * element actually exposes.
 *
 * @param {string} key canonical key from the CSS engine
 * @param {string|null} widgetType widget name, or null for a container
 * @returns {string|null} real Elementor control name, or null to drop it
 */
export function resolveSettingKey(key, widgetType) {
  if (!widgetType) {
    // Text styling lives on widgets; a container exposes no text controls.
    if (key === 'color' || key === 'align' || key.startsWith('typography_')) return null;
    return key in CONTAINER_KEYS ? CONTAINER_KEYS[key] : key;
  }

  const profile = styleProfile(widgetType);

  if (key === 'color') return profile.color ?? null;
  if (key === 'align') return profile.align ?? null;

  if (key.startsWith('typography_')) {
    if (!profile.typography) return null;
    // `typography_font_size` -> `<group>_font_size`; the group's own switcher
    // is `<group>_typography`.
    return `${profile.typography}_${key.slice('typography_'.length)}`;
  }

  for (const [concept, defaultPrefix] of Object.entries(WIDGET_GROUP_PREFIX)) {
    if (!key.startsWith(`${concept}_`)) continue;
    const override = profile[concept === 'box_shadow' ? 'boxShadow' : concept];
    if (override === null) return null;          // widget cannot be styled this way
    return `${override ?? defaultPrefix}_${key.slice(concept.length + 1)}`;
  }

  if (key === 'border_radius') return profile.borderRadius ?? WIDGET_KEYS.border_radius;
  if (key === 'padding') return profile.padding ?? WIDGET_KEYS.padding;

  return key in WIDGET_KEYS ? WIDGET_KEYS[key] : key;
}

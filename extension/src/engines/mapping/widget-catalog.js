/**
 * Widget catalog — every Elementor widget the platform knows how to target,
 * with tier (free/pro), category and reconstruction hints. The validation
 * engine uses `tier` to warn users exporting Pro widgets, and the builder's
 * "change mapping" dropdown is generated from this catalog.
 */

export const TIERS = { FREE: 'free', PRO: 'pro', THEME: 'theme-builder', WOO: 'woocommerce' };

export const WIDGETS = {
  // --- Free / core -------------------------------------------------------
  'heading':            { tier: TIERS.FREE, label: 'Heading', category: 'basic' },
  'text-editor':        { tier: TIERS.FREE, label: 'Text Editor', category: 'basic' },
  'image':              { tier: TIERS.FREE, label: 'Image', category: 'basic' },
  'button':             { tier: TIERS.FREE, label: 'Button', category: 'basic' },
  'video':              { tier: TIERS.FREE, label: 'Video', category: 'basic' },
  'divider':            { tier: TIERS.FREE, label: 'Divider', category: 'basic' },
  'spacer':             { tier: TIERS.FREE, label: 'Spacer', category: 'basic' },
  'google_maps':        { tier: TIERS.FREE, label: 'Google Maps', category: 'basic' },
  'icon':               { tier: TIERS.FREE, label: 'Icon', category: 'basic' },
  'icon-box':           { tier: TIERS.FREE, label: 'Icon Box', category: 'general' },
  'icon-list':          { tier: TIERS.FREE, label: 'Icon List', category: 'general' },
  'image-box':          { tier: TIERS.FREE, label: 'Image Box', category: 'general' },
  'image-carousel':     { tier: TIERS.FREE, label: 'Image Carousel', category: 'general' },
  'image-gallery':      { tier: TIERS.FREE, label: 'Image Gallery', category: 'general' },
  'counter':            { tier: TIERS.FREE, label: 'Counter', category: 'general' },
  'progress':           { tier: TIERS.FREE, label: 'Progress Bar', category: 'general' },
  'testimonial':        { tier: TIERS.FREE, label: 'Testimonial', category: 'general' },
  'tabs':               { tier: TIERS.FREE, label: 'Tabs', category: 'general' },
  'accordion':          { tier: TIERS.FREE, label: 'Accordion', category: 'general' },
  'toggle':             { tier: TIERS.FREE, label: 'Toggle', category: 'general' },
  'social-icons':       { tier: TIERS.FREE, label: 'Social Icons', category: 'general' },
  'alert':              { tier: TIERS.FREE, label: 'Alert', category: 'general' },
  'html':               { tier: TIERS.FREE, label: 'HTML', category: 'general' },
  'shortcode':          { tier: TIERS.FREE, label: 'Shortcode', category: 'general' },
  'menu-anchor':        { tier: TIERS.FREE, label: 'Menu Anchor', category: 'general' },
  'star-rating':        { tier: TIERS.FREE, label: 'Star Rating', category: 'general' },
  'nested-tabs':        { tier: TIERS.FREE, label: 'Tabs (Nested)', category: 'nested' },
  'nested-accordion':   { tier: TIERS.FREE, label: 'Accordion (Nested)', category: 'nested' },

  // --- Pro -----------------------------------------------------------------
  'nav-menu':           { tier: TIERS.PRO, label: 'Nav Menu', category: 'pro' },
  'mega-menu':          { tier: TIERS.PRO, label: 'Mega Menu', category: 'pro' },
  'form':               { tier: TIERS.PRO, label: 'Form', category: 'pro' },
  'login':              { tier: TIERS.PRO, label: 'Login', category: 'pro' },
  'posts':              { tier: TIERS.PRO, label: 'Posts', category: 'pro' },
  'portfolio':          { tier: TIERS.PRO, label: 'Portfolio', category: 'pro' },
  'gallery':            { tier: TIERS.PRO, label: 'Gallery (Pro)', category: 'pro' },
  'slides':             { tier: TIERS.PRO, label: 'Slides', category: 'pro' },
  'nested-carousel':    { tier: TIERS.PRO, label: 'Carousel (Nested)', category: 'pro' },
  'loop-carousel':      { tier: TIERS.PRO, label: 'Loop Carousel', category: 'pro' },
  'loop-grid':          { tier: TIERS.PRO, label: 'Loop Grid', category: 'pro' },
  'price-table':        { tier: TIERS.PRO, label: 'Price Table', category: 'pro' },
  'price-list':         { tier: TIERS.PRO, label: 'Price List', category: 'pro' },
  'countdown':          { tier: TIERS.PRO, label: 'Countdown', category: 'pro' },
  'flip-box':           { tier: TIERS.PRO, label: 'Flip Box', category: 'pro' },
  'call-to-action':     { tier: TIERS.PRO, label: 'Call to Action', category: 'pro' },
  'testimonial-carousel': { tier: TIERS.PRO, label: 'Testimonial Carousel', category: 'pro' },
  'blockquote':         { tier: TIERS.PRO, label: 'Blockquote', category: 'pro' },
  'table-of-contents':  { tier: TIERS.PRO, label: 'Table of Contents', category: 'pro' },
  'breadcrumbs':        { tier: TIERS.PRO, label: 'Breadcrumbs', category: 'theme' },
  'global':             { tier: TIERS.PRO, label: 'Global Widget', category: 'pro' },
  'template':           { tier: TIERS.PRO, label: 'Template', category: 'pro' },
  'popup':              { tier: TIERS.PRO, label: 'Popup (document)', category: 'theme' },

  // --- Theme builder ----------------------------------------------------------
  'theme-site-logo':    { tier: TIERS.THEME, label: 'Site Logo', category: 'theme' },
  'theme-site-title':   { tier: TIERS.THEME, label: 'Site Title', category: 'theme' },
  'theme-page-title':   { tier: TIERS.THEME, label: 'Page Title', category: 'theme' },
  'theme-post-title':   { tier: TIERS.THEME, label: 'Post Title', category: 'theme' },
  'theme-post-content': { tier: TIERS.THEME, label: 'Post Content', category: 'theme' },
  'theme-post-featured-image': { tier: TIERS.THEME, label: 'Featured Image', category: 'theme' },
  'search-form':        { tier: TIERS.THEME, label: 'Search Form', category: 'theme' },

  // --- WooCommerce ---------------------------------------------------------------
  'woocommerce-products':        { tier: TIERS.WOO, label: 'Products', category: 'woocommerce' },
  'woocommerce-product-price':   { tier: TIERS.WOO, label: 'Product Price', category: 'woocommerce' },
  'woocommerce-product-title':   { tier: TIERS.WOO, label: 'Product Title', category: 'woocommerce' },
  'woocommerce-product-images':  { tier: TIERS.WOO, label: 'Product Images', category: 'woocommerce' },
  'woocommerce-product-add-to-cart': { tier: TIERS.WOO, label: 'Add To Cart', category: 'woocommerce' },
  'woocommerce-menu-cart':       { tier: TIERS.WOO, label: 'Menu Cart', category: 'woocommerce' },
  'wc-archive-products':         { tier: TIERS.WOO, label: 'Archive Products', category: 'woocommerce' },
};

export function widgetInfo(widgetType) {
  return WIDGETS[widgetType] || null;
}

export function isProWidget(widgetType) {
  const info = WIDGETS[widgetType];
  return !!info && info.tier !== TIERS.FREE;
}

/** Grouped options for the builder's mapping dropdown. */
export function widgetOptionsByCategory() {
  const groups = {};
  for (const [type, info] of Object.entries(WIDGETS)) {
    const cat = info.category;
    (groups[cat] ??= []).push({ type, label: info.label, tier: info.tier });
  }
  for (const list of Object.values(groups)) list.sort((a, b) => a.label.localeCompare(b.label));
  return groups;
}

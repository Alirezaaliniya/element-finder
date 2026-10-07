/**
 * "About" content shared by the builder (dialog) and the popup (panel).
 */

import { APP } from '../../common/constants.js';
import { escapeHtml } from '../../common/utils.js';
import { t } from '../../common/i18n.js';
import { icon } from './icons.js';

export const ABOUT_LINKS = [
  { id: 'website', icon: 'website', href: 'https://nias.ir/' },
  { id: 'contribute', icon: 'github', href: 'https://github.com/Alirezaaliniya/element-finder' },
  { id: 'issues', icon: 'issue', href: 'https://github.com/Alirezaaliniya/element-finder/issues' },
  { id: 'telegram', icon: 'telegram', href: 'https://t.me/niasir' },
];

/** Markup of the About section (links open in a new tab). */
export function aboutHtml() {
  const links = ABOUT_LINKS.map((l) => `
    <a class="about-link" href="${escapeHtml(l.href)}" target="_blank" rel="noopener noreferrer">
      <span class="about-link-icon">${icon(l.icon, { size: 20 })}</span>
      <span class="about-link-text">
        <strong>${escapeHtml(t(`about.${l.id}`))}</strong>
        <small>${escapeHtml(t(`about.${l.id}Sub`))}</small>
      </span>
      <span class="about-link-arrow">${icon('external-link', { size: 14 })}</span>
    </a>`).join('');
  return `
    <div class="about">
      <div class="about-head">
        <img class="about-logo" src="../../../icon.png" alt="">
        <div>
          <strong class="about-name">${escapeHtml(APP.NAME)}</strong>
          <small class="about-version">${escapeHtml(t('about.version', { version: APP.VERSION }))}</small>
        </div>
      </div>
      <p class="about-desc">${escapeHtml(t('about.description'))}</p>
      <nav class="about-links">${links}</nav>
      <p class="about-foot">${escapeHtml(t('about.madeBy'))}</p>
    </div>`;
}

import { SUPPORTED_LANGUAGES, i18n } from '@tezfiks/mobile';

let installed = false;

/** Copies `pro:brand.tagline` over `common:brand.tagline` in every language (idempotent). */
function applyProTagline(): void {
  for (const lng of SUPPORTED_LANGUAGES) {
    const line = i18n.getResource(lng, 'pro', 'brand.tagline');
    if (typeof line === 'string' && line) i18n.addResource(lng, 'common', 'brand.tagline', line);
  }
}

/**
 * The shared login screen (PhoneScreen in @tezfiks/mobile) shows `common:brand.tagline`, the customer slogan ("Lazım
 * olan anda usta — ev və avto üçün"). In TezFiks Usta that line is the pro tagline (`pro:brand.tagline`) instead.
 * Applied as soon as i18n has loaded its bundled resources (they are never reloaded, a language change keeps it).
 */
export function installProTagline(): void {
  if (installed) return;
  installed = true;
  if (i18n.isInitialized) applyProTagline();
  i18n.on('initialized', applyProTagline);
}

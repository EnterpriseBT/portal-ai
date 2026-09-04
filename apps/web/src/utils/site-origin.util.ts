/**
 * Marketing-site origin (#506) — baked into the bundle at build time.
 *
 * The login screen's consent copy links to the public Terms and Privacy pages,
 * which live on the marketing site, not the app. That origin differs per
 * environment (prod `www.portalsai.io`, app-dev `site-dev.portalsai.io`), so it
 * is env-derived the same way the contact addresses are (`contact.util.ts`):
 * the deploy injects a `VITE_SITE_URL` build var, and this module resolves it.
 *
 * The default is the production origin, so a build that forgot to set the var —
 * and every non-Vite context (jest, node scripts), where `import.meta.env` does
 * not exist — still links to real, published pages rather than a dead URL.
 */

/** Production marketing-site origin, and the fallback. */
export const DEFAULT_SITE_ORIGIN = "https://www.portalsai.io";

/**
 * Exported for its own test: `import.meta.env` is Vite-only and each module
 * gets its own, so a test cannot inject one — the resolution is testable only
 * as a pure function. Trailing slashes are trimmed so the path join is exact.
 */
export const resolveSiteOrigin = (value: string | undefined): string => {
  const trimmed = value?.trim();
  return (trimmed ? trimmed : DEFAULT_SITE_ORIGIN).replace(/\/+$/, "");
};

// `?.` because `import.meta.env` does not exist outside a Vite build.
export const SITE_ORIGIN = resolveSiteOrigin(import.meta.env?.VITE_SITE_URL);

export const TERMS_URL = `${SITE_ORIGIN}/terms/`;
export const PRIVACY_URL = `${SITE_ORIGIN}/privacy/`;

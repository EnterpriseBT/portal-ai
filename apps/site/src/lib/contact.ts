/**
 * Business contact addresses (#369) — resolved from the build environment.
 *
 * SSM is the single place a value is written (`portalops vars set`); the deploy
 * injects it as a build env var. The site never asks the API what its own
 * support address is — that second source of truth is exactly what this ticket
 * removed.
 *
 * Deliberately free of `import.meta` so it is unit-testable: `site-context.ts`
 * runs a top-level await and reads Vite globals, neither of which survives a
 * plain module import.
 */

/**
 * The QA inbox, and the fallback.
 *
 * With the API's runtime contact read gone, an unset value can no longer fail
 * closed with a 503. Falling back to an address we own still delivers mail; an
 * empty `mailto:` is a dead link. `scripts/verify-pages.mjs` remains the
 * build-time backstop.
 *
 * Outside prod all three roles resolve here, so no non-prod surface can
 * advertise a customer-facing inbox.
 */
export const QA_EMAIL = "qa@portalsai.io";

const email = (value: string | undefined): string =>
  value?.trim() ? value.trim() : QA_EMAIL;

export const supportEmail = email(process.env.SUPPORT_EMAIL);
export const salesEmail = email(process.env.SALES_EMAIL);
/** Legal / data-controller contact — terms, privacy, and the DMARC `rua=`. */
export const adminEmail = email(process.env.ADMIN_EMAIL);

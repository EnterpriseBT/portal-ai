/**
 * Business contact addresses (#369) — baked into the bundle at build time.
 *
 * SSM is the single place a value is written (`portalops vars set`); the deploy
 * injects it as a `VITE_*` build var. The app does not fetch an address: the
 * public site-config endpoint is anonymous and rate-limited, and a support
 * address is not the kind of fact worth a request.
 *
 * This module exists because the address used to be a hardcoded personal one
 * on an unrelated domain — `apps/web` was never wired to the contact config
 * when #311 introduced it, so a constant grew beside it and shipped to paying
 * customers. One module, one source.
 */

/**
 * The QA inbox, and the fallback.
 *
 * With the API's runtime contact read removed, an unset value can no longer
 * fail closed with a 503. Falling back to an address we own still delivers
 * mail; an empty `mailto:` is a dead link in front of a customer. Outside prod
 * every role resolves here anyway, so no non-prod build can advertise a
 * customer-facing inbox.
 */
export const QA_EMAIL = "qa@portalsai.io";

/**
 * Exported for its own test: `import.meta.env` is Vite-only and each module
 * gets its own, so a test cannot inject one — the resolution is testable only
 * as a pure function.
 */
export const resolveEmail = (value: string | undefined): string =>
  value?.trim() ? value.trim() : QA_EMAIL;

// `?.` because `import.meta.env` does not exist outside a Vite build (jest,
// node scripts) — the module must import cleanly there and fall back.
export const SUPPORT_EMAIL = resolveEmail(import.meta.env?.VITE_SUPPORT_EMAIL);
export const SALES_EMAIL = resolveEmail(import.meta.env?.VITE_SALES_EMAIL);

export const SUPPORT_MAILTO = `mailto:${SUPPORT_EMAIL}`;
export const SALES_MAILTO = `mailto:${SALES_EMAIL}`;

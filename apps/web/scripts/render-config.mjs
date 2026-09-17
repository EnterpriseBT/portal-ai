// Renders the SPA's runtime configuration file (`config.js`) from container
// environment variables (#566). The residency web image is built ONCE and
// serves any customer: its OIDC issuer / client id are not baked into the
// bundle at build time (as the SaaS `VITE_*` values are) but injected at
// container startup by writing this file, which the SPA loads before its
// bundle. Consumption by the SPA is #607; this only produces the contract.
//
// Plain ESM (no dependencies) so it runs under bare `node` inside the nginx
// runtime image, and imports cleanly into the jest unit test.
//
// SECURITY: only non-secret, client-visible values belong here — this file is
// served to every browser. OIDC issuer/client-id/audience are public; a
// client secret must never be added.

/** Keys that make up the runtime config, in emit order. */
const RUNTIME_KEYS = [
  "AUTH_PROVIDER",
  "OIDC_ISSUER",
  "OIDC_CLIENT_ID",
  "OIDC_AUDIENCE",
  "DEPLOY_MODE",
];

/** Defaults preserving today's SaaS behavior when a key is unset. */
const DEFAULTS = {
  AUTH_PROVIDER: "auth0",
  DEPLOY_MODE: "saas",
};

/**
 * Build the `config.js` body from an env-like record.
 *
 * @param {Record<string, string | undefined>} env
 * @returns {string} a single `window.__RUNTIME_CONFIG__ = {...};` statement
 */
export function renderConfigJs(env = {}) {
  const config = {};
  for (const key of RUNTIME_KEYS) {
    config[key] = env[key] ?? DEFAULTS[key] ?? "";
  }
  return `window.__RUNTIME_CONFIG__ = ${JSON.stringify(config)};\n`;
}

// CLI: `node render-config.mjs` prints the rendered file to stdout; the
// container entrypoint redirects it to the served config.js.
if (import.meta.url === `file://${process.argv[1]}`) {
  process.stdout.write(renderConfigJs(process.env));
}

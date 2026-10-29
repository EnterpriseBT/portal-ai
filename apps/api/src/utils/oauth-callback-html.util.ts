/**
 * Slug-parameterized OAuth callback page.
 *
 * Every connector that authorizes via OAuth2 (`google-sheets`,
 * `microsoft-excel`, …) returns this page from its `/callback` route.
 * The page postMessages `{ type: "<slug>-authorized", connectorInstanceId,
 * accountInfo }` to `window.opener` and closes itself; the popup hook
 * (`useOAuthPopupAuthorize`) is the only consumer.
 *
 * Origin restriction is `*` for v1 — the popup window is controlled by
 * us and the message contains no secrets (just the instance id and the
 * public account info). Tighten to a specific origin once we have a
 * stable web-app domain known to the API process.
 *
 * **The page carries its own security headers (#922).** It is the one HTML
 * response the API serves that runs a script and talks to another origin,
 * and the global `helmet()` defaults forbid both: `script-src 'self'`
 * blocks the inline script, and `Cross-Origin-Opener-Policy: same-origin`
 * puts the popup in a separate browsing context group from the web app,
 * which nulls `window.opener`. The route sets `headers` over helmet's: a
 * CSP that allows exactly this page's script by hash and denies everything
 * else, and COOP `unsafe-none` so the opener survives.
 */

import { createHash } from "node:crypto";

import type { PublicAccountInfo } from "@portalai/core/contracts";

export interface RenderOAuthCallbackHtmlInput {
  slug: string;
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
}

export interface OAuthCallbackPage {
  html: string;
  headers: Record<string, string>;
}

export function renderOAuthCallbackHtml({
  slug,
  connectorInstanceId,
  accountInfo,
}: RenderOAuthCallbackHtmlInput): OAuthCallbackPage {
  if (!slug) {
    throw new Error("renderOAuthCallbackHtml: slug is required");
  }
  if (!connectorInstanceId) {
    throw new Error("renderOAuthCallbackHtml: connectorInstanceId is required");
  }
  // `<` is escaped so a provider profile field (accountInfo.metadata) holding
  // `</script>` can't end the script element early.
  const payload = JSON.stringify({
    type: `${slug}-authorized`,
    connectorInstanceId,
    accountInfo,
  }).replace(/</g, "\\u003c");
  const script = `
(function () {
  var payload = ${payload};
  if (window.opener) {
    try { window.opener.postMessage(payload, "*"); } catch (e) {}
  }
  window.close();
})();
`;
  const scriptHash = createHash("sha256").update(script).digest("base64");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title></head>
<body><script>${script}</script>
<p>Connected. You can close this window.</p>
<p data-testid="connector-instance-id" hidden>${connectorInstanceId}</p>
</body></html>`;
  return {
    html,
    headers: {
      "Content-Security-Policy": [
        "default-src 'none'",
        `script-src 'sha256-${scriptHash}'`,
        "base-uri 'none'",
        "form-action 'none'",
        "frame-ancestors 'none'",
      ].join("; "),
      "Cross-Origin-Opener-Policy": "unsafe-none",
    },
  };
}

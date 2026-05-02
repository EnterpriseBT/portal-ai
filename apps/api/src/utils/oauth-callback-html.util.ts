/**
 * Slug-parameterized OAuth callback HTML.
 *
 * Every connector that authorizes via OAuth2 (`google-sheets`,
 * `microsoft-excel`, …) returns this HTML from its `/callback` route.
 * The page postMessages `{ type: "<slug>-authorized", connectorInstanceId,
 * accountInfo }` to `window.opener` and closes itself; the popup hook
 * (`useOAuthPopupAuthorize`) is the only consumer.
 *
 * Origin restriction is `*` for v1 — the popup window is controlled by
 * us and the message contains no secrets (just the instance id and the
 * public account info). Tighten to a specific origin once we have a
 * stable web-app domain known to the API process.
 */

import type { PublicAccountInfo } from "@portalai/core/contracts";

export interface RenderOAuthCallbackHtmlInput {
  slug: string;
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
}

export function renderOAuthCallbackHtml({
  slug,
  connectorInstanceId,
  accountInfo,
}: RenderOAuthCallbackHtmlInput): string {
  if (!slug) {
    throw new Error("renderOAuthCallbackHtml: slug is required");
  }
  if (!connectorInstanceId) {
    throw new Error("renderOAuthCallbackHtml: connectorInstanceId is required");
  }
  const payload = JSON.stringify({
    type: `${slug}-authorized`,
    connectorInstanceId,
    accountInfo,
  });
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title></head>
<body><script>
(function () {
  var payload = ${payload};
  if (window.opener) {
    try { window.opener.postMessage(payload, "*"); } catch (e) {}
  }
  window.close();
})();
</script>
<p>Connected. You can close this window.</p>
<p data-testid="connector-instance-id" hidden>${connectorInstanceId}</p>
</body></html>`;
}

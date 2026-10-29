/**
 * Slug-parameterized OAuth callback page.
 *
 * Every connector that authorizes via OAuth2 (`google-sheets`,
 * `microsoft-excel`, …) answers its `/callback` route through
 * `sendOAuthCallbackPage`. The page postMessages `{ type: "<slug>-authorized",
 * connectorInstanceId, accountInfo }` to `window.opener` and closes itself;
 * the popup hook (`useOAuthPopupAuthorize`) is the only consumer.
 *
 * **The message targets the web app's origin** (`WEB_APP_URL`), never `*`
 * (#922). The opener is whatever window holds the reference when consent
 * finishes, which need not be the app any more (the user may have navigated
 * that tab away), and the payload names the account. A browser drops a
 * message whose target origin doesn't match, so an unset or wrong
 * `WEB_APP_URL` shows up as a popup that never completes.
 *
 * **The page carries its own security headers (#922).** It is the one HTML
 * response the API serves that runs a script and talks to another origin,
 * and the global `helmet()` defaults forbid both: `script-src 'self'`
 * blocks the inline script, and `Cross-Origin-Opener-Policy: same-origin`
 * puts the popup in a separate browsing context group from the web app,
 * which nulls `window.opener`. `sendOAuthCallbackPage` sets `headers` over
 * helmet's: a CSP that allows exactly this page's script by hash and denies
 * everything else, COOP `unsafe-none` so the opener survives, and
 * `Cache-Control: no-store` since the page names the user's account. Send
 * the page only through it, so no route can drop the headers.
 */

import { createHash } from "node:crypto";

import type { Response } from "express";

import type { PublicAccountInfo } from "@portalai/core/contracts";

import { environment } from "../environment.js";

export interface RenderOAuthCallbackHtmlInput {
  slug: string;
  connectorInstanceId: string;
  accountInfo: PublicAccountInfo;
  /** The origin `postMessage` targets: the web app's. */
  targetOrigin: string;
}

export interface OAuthCallbackPage {
  html: string;
  headers: Record<string, string>;
}

const HTML_ESCAPES: Record<string, string> = {
  "&": "&amp;",
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
};

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (c) => HTML_ESCAPES[c]);
}

/** `<` is escaped so a string (a provider profile field in
 *  accountInfo.metadata) holding `</script>` can't end the script element. */
function scriptLiteral(value: unknown): string {
  return JSON.stringify(value).replace(/</g, "\\u003c");
}

export function renderOAuthCallbackHtml({
  slug,
  connectorInstanceId,
  accountInfo,
  targetOrigin,
}: RenderOAuthCallbackHtmlInput): OAuthCallbackPage {
  if (!slug) {
    throw new Error("renderOAuthCallbackHtml: slug is required");
  }
  if (!connectorInstanceId) {
    throw new Error("renderOAuthCallbackHtml: connectorInstanceId is required");
  }
  if (!targetOrigin || targetOrigin === "*") {
    throw new Error(
      "renderOAuthCallbackHtml: a specific targetOrigin is required"
    );
  }
  const payload = scriptLiteral({
    type: `${slug}-authorized`,
    connectorInstanceId,
    accountInfo,
  });
  const script = `
(function () {
  var payload = ${payload};
  if (window.opener) {
    try { window.opener.postMessage(payload, ${scriptLiteral(targetOrigin)}); } catch (e) {}
  }
  window.close();
})();
`;
  const scriptHash = createHash("sha256").update(script).digest("base64");
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>Connected</title></head>
<body><script>${script}</script>
<p>Connected. You can close this window.</p>
<p data-testid="connector-instance-id" hidden>${escapeHtml(connectorInstanceId)}</p>
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
      "Cache-Control": "no-store",
    },
  };
}

/** Answers an OAuth `/callback` with the page and its headers. */
export function sendOAuthCallbackPage(
  res: Response,
  input: Omit<RenderOAuthCallbackHtmlInput, "targetOrigin">
): Response {
  const page = renderOAuthCallbackHtml({
    ...input,
    targetOrigin: new URL(environment.WEB_APP_URL).origin,
  });
  return res.status(200).type("html").set(page.headers).send(page.html);
}

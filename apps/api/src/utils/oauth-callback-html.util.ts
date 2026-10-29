/**
 * Slug-parameterized OAuth callback page.
 *
 * Every connector that authorizes via OAuth2 (`google-sheets`,
 * `microsoft-excel`, …) answers its `/callback` route through
 * `sendOAuthCallbackPage`. The page postMessages `{ type: "<slug>-authorized",
 * connectorInstanceId, accountInfo }` to `window.opener` and closes itself;
 * the popup hook (`useOAuthPopupAuthorize`) is the only consumer.
 *
 * **Every callback outcome answers with the page (#924).** A denied consent,
 * a bad or expired `state` and a failed exchange answer through
 * `sendOAuthCallbackFailurePage`, which posts `{ type: "<slug>-failed", code,
 * message }` instead. Through the JSON error handler the popup showed the
 * error envelope and the opener heard nothing, so the dialog sat
 * "connecting" until the hook's 5-minute timeout. The message is always
 * server-authored: the callback is unauthenticated and anyone can craft its
 * URL, so a provider's `error_description` is never echoed, and a 500 shows
 * `INTERNAL_ERROR_MESSAGE` as it would through `HttpService.error` (#687).
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

import { INTERNAL_ERROR_MESSAGE } from "@portalai/core/constants";
import type { PublicAccountInfo } from "@portalai/core/contracts";

import type { ApiCode } from "../constants/api-codes.constants.js";
import { environment } from "../environment.js";
import { ApiError } from "../services/http.service.js";
import { createLogger } from "./logger.util.js";

const logger = createLogger({ module: "oauth-callback" });

export type OAuthCallbackOutcome =
  | {
      kind: "authorized";
      connectorInstanceId: string;
      accountInfo: PublicAccountInfo;
    }
  | { kind: "failed"; code: string; message: string };

export interface RenderOAuthCallbackHtmlInput {
  slug: string;
  outcome: OAuthCallbackOutcome;
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
  outcome,
  targetOrigin,
}: RenderOAuthCallbackHtmlInput): OAuthCallbackPage {
  if (!slug) {
    throw new Error("renderOAuthCallbackHtml: slug is required");
  }
  if (outcome.kind === "authorized" && !outcome.connectorInstanceId) {
    throw new Error("renderOAuthCallbackHtml: connectorInstanceId is required");
  }
  if (!targetOrigin || targetOrigin === "*") {
    throw new Error(
      "renderOAuthCallbackHtml: a specific targetOrigin is required"
    );
  }
  const payload = scriptLiteral(
    outcome.kind === "authorized"
      ? {
          type: `${slug}-authorized`,
          connectorInstanceId: outcome.connectorInstanceId,
          accountInfo: outcome.accountInfo,
        }
      : { type: `${slug}-failed`, code: outcome.code, message: outcome.message }
  );
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
  const body =
    outcome.kind === "authorized"
      ? `<p>Connected. You can close this window.</p>
<p data-testid="connector-instance-id" hidden>${escapeHtml(outcome.connectorInstanceId)}</p>`
      : `<p>Authorization failed. ${escapeHtml(outcome.message)}</p>
<p>You can close this window.</p>`;
  const title = outcome.kind === "authorized" ? "Connected" : "Not connected";
  const html = `<!doctype html>
<html><head><meta charset="utf-8"><title>${title}</title></head>
<body><script>${script}</script>
${body}
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

function webAppOrigin(): string {
  return new URL(environment.WEB_APP_URL).origin;
}

/** Answers an OAuth `/callback` with the page and its headers. */
export function sendOAuthCallbackPage(
  res: Response,
  input: {
    slug: string;
    connectorInstanceId: string;
    accountInfo: PublicAccountInfo;
  }
): Response {
  const page = renderOAuthCallbackHtml({
    slug: input.slug,
    outcome: {
      kind: "authorized",
      connectorInstanceId: input.connectorInstanceId,
      accountInfo: input.accountInfo,
    },
    targetOrigin: webAppOrigin(),
  });
  return res.status(200).type("html").set(page.headers).send(page.html);
}

/**
 * Answers a failed OAuth `/callback` with the page, at the error's status.
 * The error never reaches the JSON error handler, so it's logged here.
 */
export function sendOAuthCallbackFailurePage(
  res: Response,
  input: { slug: string; error: ApiError }
): Response {
  const { slug, error } = input;
  const status = error.status ?? 500;
  const internal = status === 500;
  const log = { slug, status, code: error.code, err: error };
  if (status >= 500) logger.error(log, "OAuth callback failed");
  else logger.warn(log, "OAuth callback refused");
  const page = renderOAuthCallbackHtml({
    slug,
    outcome: {
      kind: "failed",
      code: error.code,
      message: internal ? INTERNAL_ERROR_MESSAGE : error.message,
    },
    targetOrigin: webAppOrigin(),
  });
  return res.status(status).type("html").set(page.headers).send(page.html);
}

/**
 * The refusal for a provider's `?error=` redirect. `access_denied` is the
 * user cancelling or declining consent; anything else is the provider's own
 * failure. Neither echoes the provider's text (see the module comment).
 */
export function oauthProviderError(
  providerError: string,
  codes: {
    provider: string;
    accessDenied: ApiCode;
    providerError: ApiCode;
  }
): ApiError {
  if (providerError === "access_denied") {
    return new ApiError(
      400,
      codes.accessDenied,
      "Authorization was cancelled."
    );
  }
  return new ApiError(
    400,
    codes.providerError,
    `${codes.provider} couldn't complete the authorization. Please try again.`
  );
}

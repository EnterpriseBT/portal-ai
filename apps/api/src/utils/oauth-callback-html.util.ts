/**
 * Slug-parameterized OAuth callback page.
 *
 * Every connector that authorizes via OAuth2 (`google-sheets`,
 * `microsoft-excel`, …) answers its `/callback` route through
 * `answerOAuthCallback`, which sends this page. The page postMessages `{ type: "<slug>-authorized",
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
 * URL, so a provider's `error_description` is never echoed, a 502's provider
 * response body gets fixed copy, and a 500 shows `INTERNAL_ERROR_MESSAGE` as
 * it would through `HttpService.error` (#687).
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

import { ApiCode } from "../constants/api-codes.constants.js";
import { toDbCancellationApiError } from "../db/request-cancellation.util.js";
import { environment } from "../environment.js";
import { ApiError } from "../services/http.service.js";
import type { Request } from "../types/request.js";
import { createLogger } from "./logger.util.js";
import { redactUrl } from "./redact-url.util.js";

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

/** What the page tells the user about a failure. Only server-authored text
 *  reaches it: a 500's caught message stays in the log (#687), and a 502's
 *  carries the provider's response body (`Google token exchange failed
 *  (400): {...}`), so both get fixed copy and keep their code. */
function failureMessage(error: ApiError, provider: string): string {
  const status = error.status ?? 500;
  if (status === 500) return INTERNAL_ERROR_MESSAGE;
  if (status === 502) {
    return `${provider} couldn't complete the authorization. Please try again.`;
  }
  return error.message;
}

export interface OAuthCallbackFailureInput {
  slug: string;
  /** The provider's display name, for the user-facing copy. */
  provider: string;
  error: ApiError;
}

/**
 * Answers a failed OAuth `/callback` with the page, at the error's status.
 *
 * This is the one error response the API sends itself rather than through
 * `next(err)`: the global handler answers JSON, and the popup needs the page.
 * So it does what that handler would for the request: logs through `req.log`
 * (warn below 500, error at 500+, info for an abandoned request) and skips
 * the write when the client is gone.
 */
export function sendOAuthCallbackFailurePage(
  req: Request,
  res: Response,
  { slug, provider, error }: OAuthCallbackFailureInput
): Response | void {
  const log = req.log ?? logger;
  const status = error.status ?? 500;
  const fields = {
    slug,
    status,
    code: error.code,
    message: error.message,
    route: redactUrl(req.originalUrl),
  };
  if (error.code === ApiCode.REQUEST_ABANDONED) {
    log.info(fields, "OAuth callback abandoned by client");
  } else if (status >= 500) {
    log.error(fields, "OAuth callback failed");
  } else {
    log.warn(fields, "OAuth callback refused");
  }
  if (res.destroyed || res.headersSent) return;
  const page = renderOAuthCallbackHtml({
    slug,
    outcome: {
      kind: "failed",
      code: error.code,
      message: failureMessage(error, provider),
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

export interface OAuthCallbackRoute {
  slug: string;
  /** The provider's display name, for the user-facing copy. */
  provider: string;
  codes: {
    accessDenied: ApiCode;
    providerError: ApiCode;
    invalidState: ApiCode;
  };
  handleCallback(input: { code: string; state: string }): Promise<{
    connectorInstanceId: string;
    accountInfo: PublicAccountInfo;
  }>;
  /** Maps a connector's own errors to an `ApiError`. */
  mapError(err: unknown): ApiError;
}

/**
 * The whole `/callback` route for an OAuth connector: every outcome answers
 * with the page. The provider's `?error=` (sent instead of `code` when the
 * user cancels or consent fails) is read first; a missing `code`/`state` is
 * the invalid-state refusal; anything `handleCallback` throws is mapped,
 * DB cancellations first, as the global handler would (#698).
 */
export async function answerOAuthCallback(
  req: Request,
  res: Response,
  route: OAuthCallbackRoute
): Promise<Response | void> {
  const { slug, provider, codes } = route;
  const fail = (error: ApiError) =>
    sendOAuthCallbackFailurePage(req, res, { slug, provider, error });
  const providerError =
    typeof req.query.error === "string" ? req.query.error : "";
  if (providerError) {
    return fail(
      oauthProviderError(providerError, {
        provider,
        accessDenied: codes.accessDenied,
        providerError: codes.providerError,
      })
    );
  }
  const code = typeof req.query.code === "string" ? req.query.code : "";
  const state = typeof req.query.state === "string" ? req.query.state : "";
  if (!code || !state) {
    return fail(
      new ApiError(
        400,
        codes.invalidState,
        "code and state query parameters are required"
      )
    );
  }
  try {
    const result = await route.handleCallback({ code, state });
    (req.log ?? logger).info(
      { slug, connectorInstanceId: result.connectorInstanceId },
      "OAuth callback completed"
    );
    return sendOAuthCallbackPage(res, { slug, ...result });
  } catch (err) {
    return fail(toDbCancellationApiError(err) ?? route.mapError(err));
  }
}

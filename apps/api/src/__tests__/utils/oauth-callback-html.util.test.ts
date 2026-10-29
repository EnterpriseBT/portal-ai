import { createHash } from "node:crypto";

import { describe, it, expect, jest } from "@jest/globals";
import type { Response } from "express";

import { INTERNAL_ERROR_MESSAGE } from "@portalai/core/constants";
import type { PublicAccountInfo } from "@portalai/core/contracts";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import type { Request } from "../../types/request.js";
import {
  oauthProviderError,
  renderOAuthCallbackHtml,
  sendOAuthCallbackFailurePage,
} from "../../utils/oauth-callback-html.util.js";

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("no inline script");
  return match[1];
}

function scriptPayload(html: string): Record<string, unknown> {
  const match = inlineScript(html).match(/var payload = (\{[\s\S]*?\});/);
  if (!match) throw new Error("no payload");
  return JSON.parse(match[1]);
}

const accountInfo: PublicAccountInfo = {
  identity: "alice@example.com",
  metadata: {},
};

const targetOrigin = "https://app.example.com";

function authorized(
  connectorInstanceId: string,
  info: PublicAccountInfo = accountInfo
) {
  return {
    kind: "authorized" as const,
    connectorInstanceId,
    accountInfo: info,
  };
}

describe("renderOAuthCallbackHtml", () => {
  it("embeds the slug-derived message type for google-sheets", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      outcome: authorized("ci-1"),
      targetOrigin,
    });
    expect(html).toContain('"type":"google-sheets-authorized"');
    expect(html).toContain('"connectorInstanceId":"ci-1"');
    expect(html).toContain('"identity":"alice@example.com"');
  });

  it("embeds the slug-derived message type for microsoft-excel", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "microsoft-excel",
      outcome: authorized("ci-2", {
        identity: "bob@contoso.com",
        metadata: { tenantId: "t-1" },
      }),
      targetOrigin,
    });
    expect(html).toContain('"type":"microsoft-excel-authorized"');
    expect(html).not.toContain("google-sheets-authorized");
  });

  it("includes the connector-instance-id testid for assertions", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "microsoft-excel",
      outcome: authorized("ci-42"),
      targetOrigin,
    });
    expect(html).toMatch(/data-testid="connector-instance-id"[^>]*>ci-42</);
  });

  it("allows exactly its own inline script in the CSP, by hash (#922)", () => {
    const { html, headers } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      outcome: authorized("ci-1"),
      targetOrigin,
    });
    const hash = createHash("sha256")
      .update(inlineScript(html))
      .digest("base64");
    expect(headers["Content-Security-Policy"]).toBe(
      `default-src 'none'; script-src 'sha256-${hash}'; base-uri 'none'; form-action 'none'; frame-ancestors 'none'`
    );
  });

  it("keeps the opener reachable with COOP unsafe-none, uncached (#922)", () => {
    const { headers } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      outcome: authorized("ci-1"),
      targetOrigin,
    });
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("unsafe-none");
    expect(headers["Cache-Control"]).toBe("no-store");
  });

  it("posts to the web app's origin, never * (#922)", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      outcome: authorized("ci-1"),
      targetOrigin,
    });
    expect(inlineScript(html)).toContain(
      'postMessage(payload, "https://app.example.com")'
    );
    expect(() =>
      renderOAuthCallbackHtml({
        slug: "google-sheets",
        outcome: authorized("ci-1"),
        targetOrigin: "*",
      })
    ).toThrow(/targetOrigin/);
  });

  it("HTML-escapes the connector instance id in the body", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      outcome: authorized('</p><img src=x onerror="x">'),
      targetOrigin,
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;/p&gt;&lt;img src=x onerror=&quot;x&quot;&gt;");
  });

  it("escapes < so a profile field can't close the script element", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      outcome: authorized("ci-1", {
        identity: "alice@example.com",
        metadata: { name: "</script><script>alert(1)</script>" },
      }),
      targetOrigin,
    });
    const script = inlineScript(html);
    expect(script).not.toContain("<");
    expect(script).toContain("\\u003c/script>\\u003cscript>alert(1)");
    // The escaped payload still parses back to the original value.
    const payload = script.match(/var payload = (\{[\s\S]*?\});/);
    expect(payload).not.toBeNull();
    expect(JSON.parse(payload![1]).accountInfo.metadata.name).toBe(
      "</script><script>alert(1)</script>"
    );
  });

  it("refuses an empty slug", () => {
    expect(() =>
      renderOAuthCallbackHtml({
        slug: "",
        outcome: authorized("ci-1"),
        targetOrigin,
      })
    ).toThrow(/slug/);
  });

  it("refuses a missing connectorInstanceId", () => {
    expect(() =>
      renderOAuthCallbackHtml({
        slug: "google-sheets",
        outcome: authorized(""),
        targetOrigin,
      })
    ).toThrow(/connectorInstanceId/);
  });
});

describe("renderOAuthCallbackHtml — failed outcome (#924)", () => {
  const failed = {
    kind: "failed" as const,
    code: "GOOGLE_OAUTH_ACCESS_DENIED",
    message: "Authorization was cancelled.",
  };

  it("posts <slug>-failed with the code and message", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "microsoft-excel",
      outcome: failed,
      targetOrigin,
    });
    expect(scriptPayload(html)).toEqual({
      type: "microsoft-excel-failed",
      code: "GOOGLE_OAUTH_ACCESS_DENIED",
      message: "Authorization was cancelled.",
    });
    expect(html).toContain(
      "Authorization failed. Authorization was cancelled."
    );
    expect(html).not.toContain("connector-instance-id");
  });

  it("keeps the same headers, with the CSP hash of the failure script", () => {
    const { html, headers } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      outcome: failed,
      targetOrigin,
    });
    const hash = createHash("sha256")
      .update(inlineScript(html))
      .digest("base64");
    expect(headers["Content-Security-Policy"]).toContain(
      `script-src 'sha256-${hash}'`
    );
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("unsafe-none");
    expect(headers["Cache-Control"]).toBe("no-store");
    expect(inlineScript(html)).toContain(
      'postMessage(payload, "https://app.example.com")'
    );
  });

  it("escapes the message in the body and the script", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      outcome: { ...failed, message: "</script><img src=x>" },
      targetOrigin,
    });
    expect(inlineScript(html)).not.toContain("<");
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;/script&gt;&lt;img src=x&gt;");
    expect(scriptPayload(html).message).toBe("</script><img src=x>");
  });

  it("still refuses a wildcard targetOrigin", () => {
    expect(() =>
      renderOAuthCallbackHtml({
        slug: "google-sheets",
        outcome: failed,
        targetOrigin: "*",
      })
    ).toThrow(/targetOrigin/);
  });
});

describe("oauthProviderError (#924)", () => {
  const codes = {
    provider: "Google",
    accessDenied: ApiCode.GOOGLE_OAUTH_ACCESS_DENIED,
    providerError: ApiCode.GOOGLE_OAUTH_PROVIDER_ERROR,
  };

  it("maps access_denied to a cancelled message", () => {
    const err = oauthProviderError("access_denied", codes);
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe(ApiCode.GOOGLE_OAUTH_ACCESS_DENIED);
    expect(err.message).toBe("Authorization was cancelled.");
  });

  it("maps any other error to the provider's failure, without echoing it", () => {
    const err = oauthProviderError("<b>server_error</b>", codes);
    expect(err.status).toBe(400);
    expect(err.code).toBe(ApiCode.GOOGLE_OAUTH_PROVIDER_ERROR);
    expect(err.message).toBe(
      "Google couldn't complete the authorization. Please try again."
    );
  });
});

describe("sendOAuthCallbackFailurePage (#924)", () => {
  function fakeExchange(opts: { destroyed?: boolean } = {}) {
    const sent: {
      status?: number;
      type?: string;
      headers?: object;
      body?: string;
    } = {};
    const res = {
      destroyed: opts.destroyed ?? false,
      headersSent: false,
      status(code: number) {
        sent.status = code;
        return res;
      },
      type(value: string) {
        sent.type = value;
        return res;
      },
      set(headers: object) {
        sent.headers = headers;
        return res;
      },
      send(body: string) {
        sent.body = body;
        return res;
      },
    };
    const log = { info: jest.fn(), warn: jest.fn(), error: jest.fn() };
    const req = {
      log,
      originalUrl: "/api/connectors/google-sheets/callback?code=c&state=s",
    };
    return {
      req: req as unknown as Request,
      res: res as unknown as Response,
      sent,
      log,
    };
  }

  it("answers at the error's status with its message, logged on req.log", () => {
    const { req, res, sent, log } = fakeExchange();
    sendOAuthCallbackFailurePage(req, res, {
      slug: "google-sheets",
      provider: "Google",
      error: new ApiError(
        400,
        ApiCode.GOOGLE_OAUTH_INVALID_STATE,
        "OAuth state invalid"
      ),
    });
    expect(sent.status).toBe(400);
    expect(sent.type).toBe("html");
    expect(sent.headers).toHaveProperty("Cross-Origin-Opener-Policy");
    expect(scriptPayload(sent.body!)).toEqual({
      type: "google-sheets-failed",
      code: ApiCode.GOOGLE_OAUTH_INVALID_STATE,
      message: "OAuth state invalid",
    });
    expect(log.warn).toHaveBeenCalledWith(
      expect.objectContaining({ code: ApiCode.GOOGLE_OAUTH_INVALID_STATE }),
      "OAuth callback refused"
    );
    // The URL's code and state are redacted from the log line.
    expect(JSON.stringify(log.warn.mock.calls)).not.toContain("code=c");
  });

  it("replaces a 502's provider response with fixed copy, keeping its code", () => {
    const { req, res, sent, log } = fakeExchange();
    sendOAuthCallbackFailurePage(req, res, {
      slug: "google-sheets",
      provider: "Google",
      error: new ApiError(
        502,
        ApiCode.GOOGLE_OAUTH_EXCHANGE_FAILED,
        'Google token exchange failed (400): {"error":"invalid_grant"}'
      ),
    });
    expect(sent.status).toBe(502);
    expect(sent.body).not.toContain("invalid_grant");
    expect(scriptPayload(sent.body!)).toMatchObject({
      code: ApiCode.GOOGLE_OAUTH_EXCHANGE_FAILED,
      message: "Google couldn't complete the authorization. Please try again.",
    });
    expect(log.error).toHaveBeenCalled();
  });

  it("keeps a 500's message out of the page, as HttpService.error does (#687)", () => {
    const { req, res, sent } = fakeExchange();
    sendOAuthCallbackFailurePage(req, res, {
      slug: "google-sheets",
      provider: "Google",
      error: new ApiError(
        500,
        ApiCode.GOOGLE_OAUTH_AUTHORIZE_FAILED,
        "connect ECONNREFUSED 10.0.0.5:5432"
      ),
    });
    expect(sent.status).toBe(500);
    expect(sent.body).not.toContain("ECONNREFUSED");
    expect(scriptPayload(sent.body!)).toMatchObject({
      code: ApiCode.GOOGLE_OAUTH_AUTHORIZE_FAILED,
      message: INTERNAL_ERROR_MESSAGE,
    });
  });

  it("logs an abandoned request at info and writes nothing to a gone client (#698)", () => {
    const { req, res, sent, log } = fakeExchange({ destroyed: true });
    sendOAuthCallbackFailurePage(req, res, {
      slug: "microsoft-excel",
      provider: "Microsoft",
      error: new ApiError(
        499,
        ApiCode.REQUEST_ABANDONED,
        "Client disconnected"
      ),
    });
    expect(log.info).toHaveBeenCalled();
    expect(log.error).not.toHaveBeenCalled();
    expect(sent.body).toBeUndefined();
  });
});

import { createHash } from "node:crypto";

import { describe, it, expect } from "@jest/globals";

import { renderOAuthCallbackHtml } from "../../utils/oauth-callback-html.util.js";

function inlineScript(html: string): string {
  const match = html.match(/<script>([\s\S]*?)<\/script>/);
  if (!match) throw new Error("no inline script");
  return match[1];
}

describe("renderOAuthCallbackHtml", () => {
  const accountInfo = {
    identity: "alice@example.com",
    metadata: {},
  };
  const targetOrigin = "https://app.example.com";

  it("embeds the slug-derived message type for google-sheets", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      connectorInstanceId: "ci-1",
      accountInfo,
      targetOrigin,
    });
    expect(html).toContain('"type":"google-sheets-authorized"');
    expect(html).toContain('"connectorInstanceId":"ci-1"');
    expect(html).toContain('"identity":"alice@example.com"');
  });

  it("embeds the slug-derived message type for microsoft-excel", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "microsoft-excel",
      connectorInstanceId: "ci-2",
      accountInfo: {
        identity: "bob@contoso.com",
        metadata: { tenantId: "t-1" },
      },
      targetOrigin,
    });
    expect(html).toContain('"type":"microsoft-excel-authorized"');
    expect(html).not.toContain("google-sheets-authorized");
  });

  it("includes the connector-instance-id testid for assertions", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "microsoft-excel",
      connectorInstanceId: "ci-42",
      accountInfo,
      targetOrigin,
    });
    expect(html).toMatch(/data-testid="connector-instance-id"[^>]*>ci-42</);
  });

  it("allows exactly its own inline script in the CSP, by hash (#922)", () => {
    const { html, headers } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      connectorInstanceId: "ci-1",
      accountInfo,
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
      connectorInstanceId: "ci-1",
      accountInfo,
      targetOrigin,
    });
    expect(headers["Cross-Origin-Opener-Policy"]).toBe("unsafe-none");
    expect(headers["Cache-Control"]).toBe("no-store");
  });

  it("posts to the web app's origin, never * (#922)", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      connectorInstanceId: "ci-1",
      accountInfo,
      targetOrigin,
    });
    expect(inlineScript(html)).toContain(
      'postMessage(payload, "https://app.example.com")'
    );
    expect(() =>
      renderOAuthCallbackHtml({
        slug: "google-sheets",
        connectorInstanceId: "ci-1",
        accountInfo,
        targetOrigin: "*",
      })
    ).toThrow(/targetOrigin/);
  });

  it("HTML-escapes the connector instance id in the body", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      connectorInstanceId: '</p><img src=x onerror="x">',
      accountInfo,
      targetOrigin,
    });
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;/p&gt;&lt;img src=x onerror=&quot;x&quot;&gt;");
  });

  it("escapes < so a profile field can't close the script element", () => {
    const { html } = renderOAuthCallbackHtml({
      slug: "google-sheets",
      connectorInstanceId: "ci-1",
      accountInfo: {
        identity: "alice@example.com",
        metadata: { name: "</script><script>alert(1)</script>" },
      },
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
        connectorInstanceId: "ci-1",
        accountInfo,
        targetOrigin,
      })
    ).toThrow(/slug/);
  });

  it("refuses a missing connectorInstanceId", () => {
    expect(() =>
      renderOAuthCallbackHtml({
        slug: "google-sheets",
        connectorInstanceId: "",
        accountInfo,
        targetOrigin,
      })
    ).toThrow(/connectorInstanceId/);
  });
});

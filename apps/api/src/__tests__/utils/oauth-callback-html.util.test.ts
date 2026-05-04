import { describe, it, expect } from "@jest/globals";

import { renderOAuthCallbackHtml } from "../../utils/oauth-callback-html.util.js";

describe("renderOAuthCallbackHtml", () => {
  const accountInfo = {
    identity: "alice@example.com",
    metadata: {},
  };

  it("embeds the slug-derived message type for google-sheets", () => {
    const html = renderOAuthCallbackHtml({
      slug: "google-sheets",
      connectorInstanceId: "ci-1",
      accountInfo,
    });
    expect(html).toContain('"type":"google-sheets-authorized"');
    expect(html).toContain('"connectorInstanceId":"ci-1"');
    expect(html).toContain('"identity":"alice@example.com"');
  });

  it("embeds the slug-derived message type for microsoft-excel", () => {
    const html = renderOAuthCallbackHtml({
      slug: "microsoft-excel",
      connectorInstanceId: "ci-2",
      accountInfo: { identity: "bob@contoso.com", metadata: { tenantId: "t-1" } },
    });
    expect(html).toContain('"type":"microsoft-excel-authorized"');
    expect(html).not.toContain("google-sheets-authorized");
  });

  it("includes the connector-instance-id testid for assertions", () => {
    const html = renderOAuthCallbackHtml({
      slug: "microsoft-excel",
      connectorInstanceId: "ci-42",
      accountInfo,
    });
    expect(html).toMatch(
      /data-testid="connector-instance-id"[^>]*>ci-42</
    );
  });

  it("refuses an empty slug", () => {
    expect(() =>
      renderOAuthCallbackHtml({
        slug: "",
        connectorInstanceId: "ci-1",
        accountInfo,
      })
    ).toThrow(/slug/);
  });

  it("refuses a missing connectorInstanceId", () => {
    expect(() =>
      renderOAuthCallbackHtml({
        slug: "google-sheets",
        connectorInstanceId: "",
        accountInfo,
      })
    ).toThrow(/connectorInstanceId/);
  });
});

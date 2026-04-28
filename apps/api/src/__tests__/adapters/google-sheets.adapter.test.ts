import { describe, it, expect } from "@jest/globals";
import { googleSheetsAdapter } from "../../adapters/google-sheets/google-sheets.adapter.js";

describe("googleSheetsAdapter.toPublicAccountInfo", () => {
  it("projects only googleAccountEmail into identity (refresh_token + scopes never leak)", () => {
    const out = googleSheetsAdapter.toPublicAccountInfo!({
      refresh_token: "1//super-secret-refresh-token",
      scopes: ["drive.readonly", "spreadsheets.readonly"],
      googleAccountEmail: "alice@example.com",
    });
    expect(out).toEqual({
      identity: "alice@example.com",
      metadata: {},
    });
  });

  it("returns EMPTY_ACCOUNT_INFO when credentials is null", () => {
    const out = googleSheetsAdapter.toPublicAccountInfo!(null);
    expect(out).toEqual({ identity: null, metadata: {} });
  });

  it("returns EMPTY_ACCOUNT_INFO when credentials is empty object", () => {
    const out = googleSheetsAdapter.toPublicAccountInfo!({});
    expect(out).toEqual({ identity: null, metadata: {} });
  });

  it("rejects a non-string googleAccountEmail rather than coercing", () => {
    const out = googleSheetsAdapter.toPublicAccountInfo!({
      googleAccountEmail: 123 as unknown as string,
    });
    expect(out).toEqual({ identity: null, metadata: {} });
  });

  it("ignores keys other than googleAccountEmail", () => {
    const out = googleSheetsAdapter.toPublicAccountInfo!({
      googleAccountEmail: "alice@example.com",
      somethingElse: "should-not-leak",
      refresh_token: "secret",
    });
    expect(out).toEqual({
      identity: "alice@example.com",
      metadata: {},
    });
  });
});

describe("googleSheetsAdapter — Phase A stub", () => {
  it("syncEntity throws not-implemented (Phase D wires it)", async () => {
    await expect(
      googleSheetsAdapter.syncEntity(
        {} as Parameters<typeof googleSheetsAdapter.syncEntity>[0],
        "anything"
      )
    ).rejects.toThrow(/not implemented/i);
  });

  it("queryRows throws not-implemented (Phase D wires it)", async () => {
    await expect(
      googleSheetsAdapter.queryRows(
        {} as Parameters<typeof googleSheetsAdapter.queryRows>[0],
        {} as Parameters<typeof googleSheetsAdapter.queryRows>[1]
      )
    ).rejects.toThrow(/not implemented/i);
  });
});

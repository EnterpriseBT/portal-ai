import { describe, it, expect } from "@jest/globals";
import type { ApiAuthConfig, ApiCredentials } from "@portalai/core/models";

import { ApiCode } from "../../../constants/api-codes.constants.js";
import { applyAuth } from "../../../adapters/rest-api/auth.util.js";

const noneAuth: ApiAuthConfig = { mode: "none" };
const noneCreds: ApiCredentials = { mode: "none" };

describe("applyAuth — none", () => {
  it("passes the url and init through unchanged", () => {
    const init: RequestInit = { method: "GET", headers: { "X-Trace": "abc" } };
    const result = applyAuth("https://x.test/users", init, noneAuth, noneCreds);
    expect(result.url).toBe("https://x.test/users");
    expect(result.init).toEqual(init);
    // Returns a fresh init object, not the same reference (caller may
    // mutate downstream).
    expect(result.init).not.toBe(init);
  });

  it("treats null credentials as the none-mode equivalent", () => {
    const result = applyAuth("https://x.test", {}, noneAuth, null);
    expect(result.url).toBe("https://x.test");
  });
});

describe("applyAuth — apiKey, header placement", () => {
  it("adds the configured header and leaves the url unchanged", () => {
    const auth: ApiAuthConfig = {
      mode: "apiKey",
      keyName: "X-API-Key",
      placement: "header",
    };
    const creds: ApiCredentials = { mode: "apiKey", value: "secret" };
    const result = applyAuth("https://x.test/users", {}, auth, creds);
    expect(result.url).toBe("https://x.test/users");
    expect((result.init.headers as Record<string, string>)["X-API-Key"]).toBe(
      "secret"
    );
  });

  it("preserves caller-supplied headers when adding the auth header", () => {
    const auth: ApiAuthConfig = {
      mode: "apiKey",
      keyName: "X-API-Key",
      placement: "header",
    };
    const creds: ApiCredentials = { mode: "apiKey", value: "secret" };
    const init: RequestInit = {
      method: "GET",
      headers: { "X-Trace": "abc", "Content-Type": "application/json" },
    };
    const result = applyAuth("https://x.test", init, auth, creds);
    expect(result.init.headers).toEqual({
      "X-Trace": "abc",
      "Content-Type": "application/json",
      "X-API-Key": "secret",
    });
  });
});

describe("applyAuth — apiKey, query placement", () => {
  it("appends the auth param to a url with no existing query string", () => {
    const auth: ApiAuthConfig = {
      mode: "apiKey",
      keyName: "api_key",
      placement: "query",
    };
    const creds: ApiCredentials = { mode: "apiKey", value: "abc" };
    const result = applyAuth("https://x.test/users", {}, auth, creds);
    const url = new URL(result.url);
    expect(url.searchParams.get("api_key")).toBe("abc");
  });

  it("preserves existing query params and appends the auth param", () => {
    const auth: ApiAuthConfig = {
      mode: "apiKey",
      keyName: "api_key",
      placement: "query",
    };
    const creds: ApiCredentials = { mode: "apiKey", value: "abc" };
    const result = applyAuth(
      "https://x.test/users?active=true&limit=50",
      {},
      auth,
      creds
    );
    const url = new URL(result.url);
    expect(url.searchParams.get("active")).toBe("true");
    expect(url.searchParams.get("limit")).toBe("50");
    expect(url.searchParams.get("api_key")).toBe("abc");
  });

  it("overwrites a collision when the url already carries the same param", () => {
    const auth: ApiAuthConfig = {
      mode: "apiKey",
      keyName: "api_key",
      placement: "query",
    };
    const creds: ApiCredentials = { mode: "apiKey", value: "fromAuth" };
    const result = applyAuth(
      "https://x.test/users?api_key=fromCaller",
      {},
      auth,
      creds
    );
    const url = new URL(result.url);
    expect(url.searchParams.get("api_key")).toBe("fromAuth");
  });
});

describe("applyAuth — bearer", () => {
  it("adds Authorization: Bearer <token>", () => {
    const auth: ApiAuthConfig = { mode: "bearer" };
    const creds: ApiCredentials = { mode: "bearer", token: "tok" };
    const result = applyAuth("https://x.test", {}, auth, creds);
    expect((result.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok"
    );
  });

  it("overwrites a caller-supplied Authorization header", () => {
    const auth: ApiAuthConfig = { mode: "bearer" };
    const creds: ApiCredentials = { mode: "bearer", token: "tok" };
    const init: RequestInit = {
      headers: { Authorization: "Basic stale" },
    };
    const result = applyAuth("https://x.test", init, auth, creds);
    expect((result.init.headers as Record<string, string>).Authorization).toBe(
      "Bearer tok"
    );
  });
});

describe("applyAuth — basic", () => {
  it("adds Authorization: Basic <base64(user:pass)>", () => {
    const auth: ApiAuthConfig = { mode: "basic" };
    const creds: ApiCredentials = {
      mode: "basic",
      username: "u",
      password: "p",
    };
    const result = applyAuth("https://x.test", {}, auth, creds);
    const expected = "Basic " + Buffer.from("u:p", "utf8").toString("base64");
    expect((result.init.headers as Record<string, string>).Authorization).toBe(
      expected
    );
  });

  it("produces a single-line base64 with no embedded newlines", () => {
    const auth: ApiAuthConfig = { mode: "basic" };
    const creds: ApiCredentials = {
      mode: "basic",
      // Long enough to force >76 chars of base64 — `Buffer.toString("base64")`
      // is single-line, but assert it just in case the impl ever wraps.
      username: "averyverylongusername".repeat(4),
      password: "averyverylongpassword".repeat(4),
    };
    const result = applyAuth("https://x.test", {}, auth, creds);
    const header = (result.init.headers as Record<string, string>)
      .Authorization;
    expect(header).toMatch(/^Basic [A-Za-z0-9+/=]+$/);
    expect(header).not.toContain("\n");
  });
});

describe("applyAuth — error cases", () => {
  it("throws REST_API_AUTH_FAILED on config/credentials mode mismatch", () => {
    const auth: ApiAuthConfig = { mode: "bearer" };
    const creds: ApiCredentials = { mode: "apiKey", value: "x" };
    expect(() => applyAuth("https://x.test", {}, auth, creds)).toThrow(
      expect.objectContaining({
        code: ApiCode.REST_API_AUTH_FAILED,
        details: expect.objectContaining({
          mismatch: { configMode: "bearer", credentialsMode: "apiKey" },
        }),
      })
    );
  });

  it("throws REST_API_AUTH_FAILED when credentials are missing for a non-none mode", () => {
    const auth: ApiAuthConfig = {
      mode: "apiKey",
      keyName: "X-API-Key",
      placement: "header",
    };
    expect(() => applyAuth("https://x.test", {}, auth, null)).toThrow(
      expect.objectContaining({
        code: ApiCode.REST_API_AUTH_FAILED,
        details: expect.objectContaining({ reason: "missing" }),
      })
    );
  });
});

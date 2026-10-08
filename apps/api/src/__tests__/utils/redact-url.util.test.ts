import { describe, it, expect } from "@jest/globals";

import { redactQuery, redactUrl } from "../../utils/redact-url.util.js";

// #728: SSE streams carry `?token=<JWT>`, and request logs wrote it verbatim.
describe("redactUrl (#728)", () => {
  it("redacts the SSE token and keeps the path and other parameters", () => {
    expect(
      redactUrl("/api/sse/portals/p1/stream?token=eyJ.secret.jwt&x=1")
    ).toBe("/api/sse/portals/p1/stream?token=[REDACTED]&x=1");
  });

  it.each([
    "access_token",
    "id_token",
    "refresh_token",
    "code",
    "api_key",
    "apikey",
    "key",
    "secret",
    "client_secret",
    "signature",
    "sig",
    "password",
  ])("redacts %s", (param) => {
    expect(redactUrl(`/a?${param}=SECRET&keep=1`)).toBe(
      `/a?${param}=[REDACTED]&keep=1`
    );
  });

  it("matches names case-insensitively and redacts every repeat", () => {
    expect(redactUrl("/a?Token=S1&TOKEN=S2&other=ok")).toBe(
      "/a?Token=[REDACTED]&TOKEN=[REDACTED]&other=ok"
    );
  });

  it("keeps a URL with no query string, and a fragment", () => {
    expect(redactUrl("/api/health")).toBe("/api/health");
    expect(redactUrl("/a?token=S#frag")).toBe("/a?token=[REDACTED]#frag");
  });

  it("drops an undecodable parameter on its own (fail closed), keeping the rest", () => {
    expect(redactUrl("/a?%E0%A4%A=SECRET&jobId=123&token=S")).toBe(
      "/a?jobId=123&token=[REDACTED]"
    );
  });

  // #728 (code review): Express's extended parser folds these into values
  // that still authenticate, and camelCase names are credentials too.
  it.each([
    ["token[]=S", "token[]=[REDACTED]"],
    ["token%5B%5D=S", "token%5B%5D=[REDACTED]"],
    ["token[0]=S", "token[0]=[REDACTED]"],
    ["auth[token]=S", "auth[token]=[REDACTED]"],
    ["accessToken=S", "accessToken=[REDACTED]"],
    ["Access-Token=S", "Access-Token=[REDACTED]"],
    ["idToken=S", "idToken=[REDACTED]"],
  ])("redacts %s", (param, expected) => {
    expect(redactUrl(`/a?${param}&keep=1`)).toBe(`/a?${expected}&keep=1`);
  });

  it("passes undefined through", () => {
    expect(redactUrl(undefined)).toBeUndefined();
  });
});

describe("redactQuery (#728)", () => {
  it("redacts sensitive keys of the parsed query object, case-insensitively", () => {
    expect(redactQuery({ token: "S", Access_Token: "S2", x: "1" })).toEqual({
      token: "[REDACTED]",
      Access_Token: "[REDACTED]",
      x: "1",
    });
  });

  it("redacts at any depth and inside arrays, and camelCase names", () => {
    expect(
      redactQuery({
        token: ["S"],
        auth: { access_token: "S2", ok: "1" },
        accessToken: "S3",
        list: [{ token: "S4" }],
      })
    ).toEqual({
      token: "[REDACTED]",
      auth: { access_token: "[REDACTED]", ok: "1" },
      accessToken: "[REDACTED]",
      list: [{ token: "[REDACTED]" }],
    });
  });

  it("passes non-objects through", () => {
    expect(redactQuery(undefined)).toBeUndefined();
    expect(redactQuery("token=S")).toBe("token=S");
  });
});

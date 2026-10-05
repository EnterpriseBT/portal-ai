import { describe, it, expect } from "@jest/globals";
import type { IncomingMessage, ServerResponse } from "http";

import { httpLogLevel } from "../../middleware/logger.middleware.js";

const res = (statusCode: number, locals: Record<string, unknown> = {}) =>
  ({ statusCode, locals }) as unknown as ServerResponse;
const req = {} as IncomingMessage;

describe("httpLogLevel (#698)", () => {
  it("logs an expected-backpressure 503 (flagged by the error handler) at warn", () => {
    expect(
      httpLogLevel(
        req,
        res(503, { logAsWarn: true }),
        new Error("failed with status code 503")
      )
    ).toBe("warn");
  });

  it("keeps unflagged 5xx and errored responses at error", () => {
    expect(httpLogLevel(req, res(503), new Error("x"))).toBe("error");
    expect(httpLogLevel(req, res(500))).toBe("error");
    expect(httpLogLevel(req, res(200), new Error("x"))).toBe("error");
  });

  it("keeps 4xx at warn and 2xx/3xx at info", () => {
    expect(httpLogLevel(req, res(404))).toBe("warn");
    expect(httpLogLevel(req, res(304))).toBe("info");
    expect(httpLogLevel(req, res(200))).toBe("info");
  });
});

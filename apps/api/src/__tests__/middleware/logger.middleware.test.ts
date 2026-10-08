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

// #728: SSE streams authenticate with `?token=<JWT>`, and request logs wrote
// the URL verbatim: live bearer tokens in CloudWatch.
describe("request URL redaction (#728)", () => {
  async function captured(
    path: string,
    status: number,
    inRequest?: (req: import("express").Request) => void
  ): Promise<string> {
    const { Writable } = await import("node:stream");
    const pino = (await import("pino")).default;
    const express = (await import("express")).default;
    const request = (await import("supertest")).default;
    const { createHttpLogger } =
      await import("../../middleware/logger.middleware.js");
    let out = "";
    const sink = new Writable({
      write(chunk, _enc, cb) {
        out += chunk.toString();
        cb();
      },
    });
    const base = pino({ level: "info" }, sink);
    const app = express();
    app.use(createHttpLogger(base));
    app.get(/.*/, (req, res) => {
      req.log.info("inside the request");
      inRequest?.(req);
      res.status(status).end();
    });
    await request(app).get(path);
    return out;
  }

  it("redacts ?token= on the request line, the message, and req.log lines", async () => {
    const out = await captured(
      "/api/sse/portals/p1/stream?token=SECRET.JWT.VALUE&x=1",
      200
    );
    expect(out).not.toContain("SECRET.JWT.VALUE");
    expect(out).toContain("token=[REDACTED]");
    expect(out).toContain("inside the request");
  });

  it("redacts it on an error response's message too", async () => {
    const out = await captured("/api/sse/jobs/j1/events?token=SECRET2", 500);
    expect(out).not.toContain("SECRET2");
  });

  it("the base logger's req serializer redacts a logged raw request", async () => {
    const { serializeRequest } = await import("../../utils/logger.util.js");
    const out = serializeRequest({
      method: "GET",
      url: "/api/sse/x?token=SECRET3",
      headers: {},
      socket: {},
    } as never);
    expect(out.url).toBe("/api/sse/x?token=[REDACTED]");
  });

  // #728 (code review): pino-http's child replaced the base logger's
  // serializers and redact paths for every request-scoped log, so the #540
  // PII-safe error serializer and the `*.token` redaction were off in-request.
  it("request-scoped logs keep the base error serializer and redact paths", async () => {
    const out = await captured("/api/things", 200, (req) =>
      req.log.error(
        {
          err: Object.assign(new Error("dup"), {
            code: "23505",
            detail: "Key (email)=(pii@example.com) already exists.",
          }),
          body: { token: "BODY.SECRET" },
        },
        "in-request error"
      )
    );
    expect(out).toContain("in-request error");
    expect(out).not.toContain("pii@example.com");
    expect(out).not.toContain("BODY.SECRET");
  });

  it("guard: every req.url / originalUrl in the API source is wrapped in redactUrl()", async () => {
    const { readdirSync, readFileSync, statSync } = await import("node:fs");
    const { join, dirname } = await import("node:path");
    const { fileURLToPath } = await import("node:url");
    // src/, from this file (not process.cwd()).
    const root = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
    const RAW =
      /\b(?:req|request|expressReq)\.(?:url|originalUrl)\b|\.originalUrl\b/g;
    const WRAPPED = /redactUrl\(\s*$/;
    const offenders: string[] = [];
    const walk = (dir: string) => {
      for (const name of readdirSync(dir)) {
        const full = join(dir, name);
        if (name === "__tests__" || name === "scripts") continue;
        if (statSync(full).isDirectory()) walk(full);
        else if (name.endsWith(".ts")) {
          const lines = readFileSync(full, "utf8").split("\n");
          lines.forEach((line, i) => {
            if (/^\s*(\/\/|\*)/.test(line)) return;
            for (const m of line.matchAll(RAW)) {
              // Wrapped when `redactUrl(` directly precedes this occurrence,
              // on the same line or ending the previous one (a prettier wrap).
              const before = line.slice(0, m.index);
              const wrapped =
                WRAPPED.test(before) ||
                (before.trim() === "" && WRAPPED.test(lines[i - 1] ?? ""));
              if (!wrapped)
                offenders.push(`${full.slice(root.length + 1)}:${i + 1}`);
            }
          });
        }
      }
    };
    walk(root);
    expect(offenders).toEqual([]);
  });
});

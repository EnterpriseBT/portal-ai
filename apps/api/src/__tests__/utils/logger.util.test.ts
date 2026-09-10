import { Writable } from "node:stream";

import { describe, it, expect } from "@jest/globals";
import pino from "pino";

import {
  createLogger,
  logger,
  sanitizeError,
} from "../../utils/logger.util.js";
import { requestContext } from "../../utils/request-context.util.js";

/** A PostgresError as postgres.js builds it — customer value in `detail`. */
class FakePostgresError extends Error {
  severity = "ERROR";
  code = "23505";
  detail = "Key (email)=(alice@corp.com) already exists.";
  where = "INSERT INTO users ...";
  table = "users";
  column = "email";
  constraint = "users_email_unique";
  constructor() {
    super(
      'duplicate key value violates unique constraint "users_email_unique"'
    );
    this.name = "PostgresError";
  }
}

/** A DrizzleQueryError — `.message` embeds the SQL + bound customer params. */
class FakeDrizzleQueryError extends Error {
  constructor(cause: Error) {
    super(
      "Failed query: insert into users (email) values ($1)\nparams: alice@corp.com"
    );
    this.name = "DrizzleQueryError";
    this.cause = cause;
  }
}

const CUSTOMER_VALUE = "alice@corp.com";

describe("createLogger + requestContext", () => {
  it("falls back to the root logger when no request context is active", () => {
    const log = createLogger({ module: "test" });
    // Proxy forwards all Logger methods at call time.
    expect(typeof log.info).toBe("function");
    expect(typeof log.error).toBe("function");
    // Level should reflect the root logger's level when outside a request.
    expect(log.level).toBe(logger.level);
  });

  it("uses the request logger's bindings when inside a request context", () => {
    const reqLog = pino(
      { level: "info" },
      pino.transport({
        target: "pino/file",
        options: { destination: "/dev/null" },
      })
    ).child({ reqId: "req-abc", userId: "user-xyz" });

    const moduleLog = createLogger({ module: "service-a" });

    requestContext.run({ log: reqLog }, () => {
      const bindings = moduleLog.bindings();
      expect(bindings.reqId).toBe("req-abc");
      expect(bindings.userId).toBe("user-xyz");
      expect(bindings.module).toBe("service-a");
    });
  });

  it("preserves context across async boundaries", async () => {
    const reqLog = logger.child({ reqId: "req-async" });
    const moduleLog = createLogger({ module: "async-svc" });

    await requestContext.run({ log: reqLog }, async () => {
      await Promise.resolve();
      await new Promise((r) => setImmediate(r));
      expect(moduleLog.bindings().reqId).toBe("req-async");
    });
  });

  it("does not leak one request's context into another", () => {
    const logA = logger.child({ reqId: "A" });
    const logB = logger.child({ reqId: "B" });
    const moduleLog = createLogger({ module: "svc" });

    requestContext.run({ log: logA }, () => {
      expect(moduleLog.bindings().reqId).toBe("A");
    });
    requestContext.run({ log: logB }, () => {
      expect(moduleLog.bindings().reqId).toBe("B");
    });
    // Outside any run(): no reqId.
    expect(moduleLog.bindings().reqId).toBeUndefined();
  });
});

describe("sanitizeError — DB-error PII redaction (#540)", () => {
  it("drops PostgresError value fields and reduces the message to the SQLSTATE", () => {
    const out = sanitizeError(new FakePostgresError()) as Record<
      string,
      unknown
    >;

    expect(out.type).toBe("PostgresError");
    expect(out.message).toBe("Database error (23505)");
    expect(out.code).toBe("23505");
    expect(typeof out.stack).toBe("string");
    // None of the customer value / wire fields survive.
    expect(out).not.toHaveProperty("detail");
    expect(out).not.toHaveProperty("where");
    expect(out).not.toHaveProperty("table");
    expect(out).not.toHaveProperty("column");
    expect(out).not.toHaveProperty("constraint");
    expect(JSON.stringify(out)).not.toContain(CUSTOMER_VALUE);
  });

  it("sanitizes the DrizzleQueryError message and its PG cause (no SQL/params)", () => {
    const out = sanitizeError(
      new FakeDrizzleQueryError(new FakePostgresError())
    ) as Record<string, unknown>;

    expect(out.type).toBe("DrizzleQueryError");
    expect(out.message).toBe("Database query failed");
    const cause = out.cause as Record<string, unknown>;
    expect(cause.type).toBe("PostgresError");
    expect(cause.message).toBe("Database error (23505)");
    // The whole serialized shape carries no SQL text, params, or values.
    const serialized = JSON.stringify(out);
    expect(serialized).not.toContain(CUSTOMER_VALUE);
    expect(serialized).not.toContain("Failed query:");
    expect(serialized).not.toContain("params:");
  });

  it("keeps a plain Error intact (type, message, stack)", () => {
    const out = sanitizeError(new Error("boom")) as Record<string, unknown>;
    expect(out.type).toBe("Error");
    expect(out.message).toBe("boom");
    expect(typeof out.stack).toBe("string");
  });

  it("emits only the JS type for a non-Error thrown value (never its content)", () => {
    expect(sanitizeError("raw row: alice@corp.com")).toEqual({
      type: "string",
    });
    expect(sanitizeError({ email: CUSTOMER_VALUE })).toEqual({
      type: "object",
    });
    expect(
      JSON.stringify(sanitizeError({ email: CUSTOMER_VALUE }))
    ).not.toContain(CUSTOMER_VALUE);
  });

  it("wires into pino under both the `err` and `error` keys", async () => {
    const lines: string[] = [];
    const stream = new Writable({
      write(chunk, _enc, cb) {
        lines.push(chunk.toString());
        cb();
      },
    });
    const testLogger = pino(
      { serializers: { err: sanitizeError, error: sanitizeError } },
      stream
    );

    testLogger.error(
      { err: new FakeDrizzleQueryError(new FakePostgresError()) },
      "x"
    );
    testLogger.error({ error: new FakePostgresError() }, "y");

    const output = lines.join("");
    expect(output).not.toContain(CUSTOMER_VALUE);
    expect(output).not.toContain("Failed query:");
    // The serializer ran for both keys — sanitized messages are present.
    expect(output).toContain("Database query failed");
    expect(output).toContain("Database error (23505)");
  });
});

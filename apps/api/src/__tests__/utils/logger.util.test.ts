import { describe, it, expect } from "@jest/globals";
import pino from "pino";

import { createLogger, logger } from "../../utils/logger.util.js";
import { requestContext } from "../../utils/request-context.util.js";

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
      pino.transport({ target: "pino/file", options: { destination: "/dev/null" } }),
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

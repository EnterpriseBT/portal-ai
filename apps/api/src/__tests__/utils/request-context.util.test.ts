import { describe, it, expect, jest } from "@jest/globals";
import type pino from "pino";

import {
  requestContext,
  memoizeForRequest,
} from "../../utils/request-context.util.js";

// A fresh store per run — the middleware creates one per request, so the memo
// must not leak across runs.
const newStore = () => ({ log: {} as pino.Logger });

describe("memoizeForRequest (#647)", () => {
  it("runs the factory once per key within a request context", async () => {
    const factory = jest.fn(async () => ({ v: Math.random() }));
    await requestContext.run(newStore(), async () => {
      const a = await memoizeForRequest("k", factory);
      const b = await memoizeForRequest("k", factory);
      expect(a).toBe(b); // same cached value
      expect(factory).toHaveBeenCalledTimes(1);

      // A distinct key resolves separately.
      await memoizeForRequest("k2", factory);
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  it("runs the factory every time when there is no request context", async () => {
    const factory = jest.fn(async () => ({}));
    await memoizeForRequest("k", factory);
    await memoizeForRequest("k", factory);
    expect(factory).toHaveBeenCalledTimes(2);
  });

  it("does not cache a rejection — the next caller retries", async () => {
    let calls = 0;
    const factory = jest.fn(async () => {
      calls += 1;
      if (calls === 1) throw new Error("boom");
      return "ok";
    });
    await requestContext.run(newStore(), async () => {
      await expect(memoizeForRequest("k", factory)).rejects.toThrow("boom");
      await expect(memoizeForRequest("k", factory)).resolves.toBe("ok");
      expect(factory).toHaveBeenCalledTimes(2);
    });
  });

  it("shares one in-flight resolution for concurrent same-key callers", async () => {
    let running = 0;
    let peak = 0;
    const factory = jest.fn(async () => {
      running += 1;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 10));
      running -= 1;
      return "v";
    });
    await requestContext.run(newStore(), async () => {
      await Promise.all([
        memoizeForRequest("k", factory),
        memoizeForRequest("k", factory),
      ]);
    });
    // The promise is cached, so both callers share one run (no overlap).
    expect(factory).toHaveBeenCalledTimes(1);
    expect(peak).toBe(1);
  });

  it("isolates memo state per request run", async () => {
    const factory = jest.fn(async () => "v");
    await requestContext.run(newStore(), () => memoizeForRequest("k", factory));
    await requestContext.run(newStore(), () => memoizeForRequest("k", factory));
    // A fresh store each run → no cross-request cache hit.
    expect(factory).toHaveBeenCalledTimes(2);
  });
});

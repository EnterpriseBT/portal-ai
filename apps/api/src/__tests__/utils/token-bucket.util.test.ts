import { describe, it, expect } from "@jest/globals";
import { TokenBucket } from "../../utils/token-bucket.util.js";

describe("TokenBucket", () => {
  it("acquires immediately when tokens are available", async () => {
    const bucket = new TokenBucket({ ratePerSec: 10 });
    await expect(bucket.acquire()).resolves.toBeUndefined();
    bucket.destroy();
  });

  it("queues acquires past the initial pool and serves them on refill", async () => {
    // Drain the initial pool (size = ratePerSec), then queue one
    // more acquire. It should resolve on the next refill interval
    // (~1s). Real timers; fake-timer + setInterval interaction is
    // flaky enough that the explicit-wait shape is more robust.
    const bucket = new TokenBucket({ ratePerSec: 10 });
    for (let i = 0; i < 10; i++) {
      await bucket.acquire();
    }
    const t0 = Date.now();
    await bucket.acquire();
    const elapsed = Date.now() - t0;
    expect(elapsed).toBeGreaterThanOrEqual(800);
    bucket.destroy();
  }, 5_000);

  it("destroy releases pending waiters without hanging", async () => {
    const bucket = new TokenBucket({ ratePerSec: 1 });
    await bucket.acquire();
    const waiter = bucket.acquire();
    bucket.destroy();
    await expect(waiter).resolves.toBeUndefined();
  });

  it("rejects non-positive ratePerSec", () => {
    expect(() => new TokenBucket({ ratePerSec: 0 })).toThrow();
    expect(() => new TokenBucket({ ratePerSec: -1 })).toThrow();
  });
});

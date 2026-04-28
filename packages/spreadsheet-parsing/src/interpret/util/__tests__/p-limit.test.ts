import { describe, it, expect } from "@jest/globals";

import { pLimit } from "../p-limit.js";

function deferred<T>(): {
  promise: Promise<T>;
  resolve: (v: T) => void;
} {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => {
    resolve = r;
  });
  return { promise, resolve };
}

describe("pLimit", () => {
  it("caps the number of simultaneously running tasks", async () => {
    const limit = pLimit(2);
    let running = 0;
    let peak = 0;
    const task = async () => {
      running++;
      peak = Math.max(peak, running);
      await new Promise((r) => setTimeout(r, 5));
      running--;
    };
    await Promise.all(Array.from({ length: 8 }, () => limit(task)));
    expect(peak).toBe(2);
  });

  it("runs tasks under the cap immediately without queueing", async () => {
    const limit = pLimit(4);
    const order: number[] = [];
    await Promise.all(
      [1, 2, 3].map((n) =>
        limit(async () => {
          order.push(n);
        })
      )
    );
    expect(order).toEqual([1, 2, 3]);
  });

  it("continues scheduling queued tasks after failures", async () => {
    const limit = pLimit(1);
    const results = await Promise.allSettled([
      limit(async () => {
        throw new Error("boom");
      }),
      limit(async () => "ok"),
    ]);
    expect(results[0].status).toBe("rejected");
    expect(results[1].status).toBe("fulfilled");
    expect(
      (results[1] as PromiseFulfilledResult<string>).value
    ).toBe("ok");
  });

  it("preserves result ordering via Promise.all(inputs.map(schedule))", async () => {
    const limit = pLimit(3);
    const inputs = [10, 20, 30, 40, 50];
    // Stagger resolution so first-started is not first-finished.
    const delays = [50, 10, 30, 5, 20];
    const results = await Promise.all(
      inputs.map((v, i) =>
        limit(async () => {
          await new Promise((r) => setTimeout(r, delays[i]));
          return v;
        })
      )
    );
    expect(results).toEqual(inputs);
  });

  it("rejects non-positive cap", () => {
    expect(() => pLimit(0)).toThrow();
    expect(() => pLimit(-1)).toThrow();
  });

  it("each instance has its own counter", async () => {
    const a = pLimit(1);
    const b = pLimit(1);
    const deferredA = deferred<void>();
    const deferredB = deferred<void>();
    // Both schedules should start running concurrently — different limiters.
    let aStarted = false;
    let bStarted = false;
    const pa = a(async () => {
      aStarted = true;
      await deferredA.promise;
    });
    const pb = b(async () => {
      bStarted = true;
      await deferredB.promise;
    });
    await new Promise((r) => setTimeout(r, 0));
    expect(aStarted).toBe(true);
    expect(bStarted).toBe(true);
    deferredA.resolve();
    deferredB.resolve();
    await Promise.all([pa, pb]);
  });
});

import {
  describe,
  it,
  expect,
  beforeEach,
  afterEach,
  jest,
} from "@jest/globals";

import {
  AdmissionGate,
  GateRejectedError,
  type AdmissionGateOptions,
} from "../../utils/admission-gate.util.js";

/** A promise whose settlement the test controls — stands in for tile work. */
function deferred<T = void>() {
  let resolve!: (v: T) => void;
  let reject!: (e: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Let queued microtasks (admission hand-offs) run. */
const flush = () => new Promise<void>((r) => setImmediate(r));

const OPTS: AdmissionGateOptions = {
  concurrency: 2,
  maxQueue: 2,
  maxWaitMs: 1_000,
  perKeyLimit: 2,
};

async function rejection(p: Promise<unknown>): Promise<GateRejectedError> {
  try {
    await p;
  } catch (e) {
    return e as GateRejectedError;
  }
  throw new Error("expected the gate to reject");
}

describe("AdmissionGate (#698)", () => {
  it("admits up to `concurrency` holders immediately", async () => {
    const gate = new AdmissionGate(OPTS);
    const a = deferred();
    const b = deferred();
    const started: string[] = [];
    void gate.run("org", undefined, () => (started.push("a"), a.promise));
    void gate.run("org", undefined, () => (started.push("b"), b.promise));
    await flush();
    expect(started).toEqual(["a", "b"]);
    expect(gate.stats().active).toBe(2);
    a.resolve();
    b.resolve();
  });

  it("queues past `concurrency` and admits waiters in FIFO order", async () => {
    const gate = new AdmissionGate({ ...OPTS, concurrency: 1, maxQueue: 5 });
    const first = deferred();
    const order: string[] = [];
    const p0 = gate.run("o1", undefined, () => first.promise);
    const p1 = gate.run("o2", undefined, async () => void order.push("w1"));
    const p2 = gate.run("o3", undefined, async () => void order.push("w2"));
    await flush();
    expect(order).toEqual([]);
    expect(gate.stats().queued).toBe(2);
    first.resolve();
    await Promise.all([p0, p1, p2]);
    expect(order).toEqual(["w1", "w2"]);
  });

  it("rejects with `queue_full` when the queue is at `maxQueue`", async () => {
    const gate = new AdmissionGate({ ...OPTS, concurrency: 1, maxQueue: 1 });
    const hold = deferred();
    void gate.run("o", undefined, () => hold.promise);
    const waiting = gate.run("o2", undefined, async () => undefined);
    const err = await rejection(
      gate.run("o3", undefined, async () => undefined)
    );
    expect(err).toBeInstanceOf(GateRejectedError);
    expect(err.reason).toBe("queue_full");
    hold.resolve();
    await waiting;
  });

  describe("with fake timers", () => {
    beforeEach(() => {
      jest.useFakeTimers();
    });
    afterEach(() => {
      jest.useRealTimers();
    });

    it("rejects a waiter with `timeout` once `maxWaitMs` passes", async () => {
      const gate = new AdmissionGate({ ...OPTS, concurrency: 1 });
      const hold = deferred();
      void gate.run("o", undefined, () => hold.promise);
      const waiting = rejection(
        gate.run("o2", undefined, async () => undefined)
      );
      jest.advanceTimersByTime(OPTS.maxWaitMs);
      const err = await waiting;
      expect(err.reason).toBe("timeout");
      expect(gate.stats().queued).toBe(0);
      hold.resolve();
    });

    it("leaves no timers behind once the queue drains", async () => {
      const gate = new AdmissionGate({ ...OPTS, concurrency: 1 });
      const hold = deferred();
      const p0 = gate.run("o", undefined, () => hold.promise);
      const p1 = gate.run("o2", undefined, async () => undefined);
      expect(jest.getTimerCount()).toBe(1);
      hold.resolve();
      await Promise.all([p0, p1]);
      expect(jest.getTimerCount()).toBe(0);
    });
  });

  it("removes a waiter aborted while queued (and rejects an already-aborted signal)", async () => {
    const gate = new AdmissionGate({ ...OPTS, concurrency: 1 });
    const hold = deferred();
    void gate.run("o", undefined, () => hold.promise);
    const ctrl = new AbortController();
    const fn = jest.fn(async () => undefined);
    const waiting = rejection(gate.run("o2", ctrl.signal, fn));
    ctrl.abort();
    expect((await waiting).reason).toBe("aborted");
    expect(gate.stats().queued).toBe(0);

    const pre = await rejection(gate.run("o3", ctrl.signal, fn));
    expect(pre.reason).toBe("aborted");
    hold.resolve();
    await flush();
    expect(fn).not.toHaveBeenCalled();
  });

  it("does not release a slot when the holder's signal aborts (fn owns its cancellation)", async () => {
    const gate = new AdmissionGate(OPTS);
    const ctrl = new AbortController();
    const hold = deferred();
    const p = gate.run("o", ctrl.signal, () => hold.promise);
    await flush();
    ctrl.abort();
    await flush();
    expect(gate.stats().active).toBe(1);
    hold.resolve();
    await p;
    expect(gate.stats().active).toBe(0);
  });

  it("releases the slot when `fn` rejects, and propagates the error", async () => {
    const gate = new AdmissionGate({ ...OPTS, concurrency: 1 });
    const boom = new Error("boom");
    await expect(
      gate.run("o", undefined, async () => {
        throw boom;
      })
    ).rejects.toBe(boom);
    expect(gate.stats()).toEqual({ active: 0, queued: 0, activeByKey: {} });
    await expect(gate.run("o", undefined, async () => 7)).resolves.toBe(7);
  });

  it("skips a waiter whose key is at `perKeyLimit` in favour of another key", async () => {
    const gate = new AdmissionGate({
      concurrency: 3,
      maxQueue: 5,
      maxWaitMs: 1_000,
      perKeyLimit: 1,
    });
    const busyHold = deferred();
    const order: string[] = [];
    void gate.run("busy", undefined, () => busyHold.promise);
    // The busy org's second request is capped by perKeyLimit even though
    // global slots are free; another org's request is admitted past it.
    const capped = gate.run(
      "busy",
      undefined,
      async () => void order.push("busy-2")
    );
    await gate.run("quiet", undefined, async () => void order.push("quiet"));
    expect(order).toEqual(["quiet"]);
    expect(gate.stats().queued).toBe(1);

    // No starvation: once the busy org's own slot frees, its waiter runs.
    busyHold.resolve();
    await capped;
    expect(order).toEqual(["quiet", "busy-2"]);
  });

  it("reports active, queued and per-key holders in `stats()`", async () => {
    const gate = new AdmissionGate({ ...OPTS, concurrency: 2, maxQueue: 3 });
    const a = deferred();
    const b = deferred();
    void gate.run("o1", undefined, () => a.promise);
    void gate.run("o2", undefined, () => b.promise);
    const c = gate.run("o1", undefined, async () => undefined);
    await flush();
    expect(gate.stats()).toEqual({
      active: 2,
      queued: 1,
      activeByKey: { o1: 1, o2: 1 },
    });
    a.resolve();
    b.resolve();
    await c;
    expect(gate.stats()).toEqual({ active: 0, queued: 0, activeByKey: {} });
  });

  it("hands each freed slot to exactly one waiter under concurrent release", async () => {
    const gate = new AdmissionGate({ ...OPTS, concurrency: 2, maxQueue: 4 });
    const holds = [deferred(), deferred()];
    let peak = 0;
    let running = 0;
    const tracked = () => async () => {
      running++;
      peak = Math.max(peak, running);
      await flush();
      running--;
    };
    const ps = [
      gate.run("a", undefined, () => holds[0].promise),
      gate.run("b", undefined, () => holds[1].promise),
      gate.run("c", undefined, tracked()),
      gate.run("d", undefined, tracked()),
      gate.run("e", undefined, tracked()),
    ];
    holds[0].resolve();
    holds[1].resolve();
    await Promise.all(ps);
    expect(peak).toBeLessThanOrEqual(2);
    expect(gate.stats()).toEqual({ active: 0, queued: 0, activeByKey: {} });
  });
});

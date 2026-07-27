import { jest } from "@jest/globals";

import { rafCoalesce } from "../raf-coalesce.util";

// #278: responsive reflow is bursty — dragging a window edge, opening a side
// panel, or rotating a device produces a run of ResizeObserver ticks. Each
// one would otherwise cost a postMessage, a full redraw and a re-measure, so
// they collapse to one per animation frame.

/** A manually-pumped requestAnimationFrame so a test controls frames. */
const installRaf = () => {
  const queue: FrameRequestCallback[] = [];
  const original = global.requestAnimationFrame;
  const originalCancel = global.cancelAnimationFrame;

  global.requestAnimationFrame = ((cb: FrameRequestCallback) => {
    queue.push(cb);
    return queue.length;
  }) as typeof global.requestAnimationFrame;
  global.cancelAnimationFrame = ((handle: number) => {
    queue.splice(handle - 1, 1);
  }) as typeof global.cancelAnimationFrame;

  return {
    /** Run everything queued for the current frame. */
    flush: () => {
      const pending = queue.splice(0);
      for (const cb of pending) cb(0);
    },
    pending: () => queue.length,
    restore: () => {
      global.requestAnimationFrame = original;
      global.cancelAnimationFrame = originalCancel;
    },
  };
};

describe("rafCoalesce", () => {
  let raf: ReturnType<typeof installRaf>;

  beforeEach(() => {
    raf = installRaf();
  });

  afterEach(() => {
    raf.restore();
  });

  it("collapses several calls in one frame into one, with the last value", () => {
    const fn = jest.fn<(value: number) => void>();
    const coalesced = rafCoalesce(fn);

    coalesced(100);
    coalesced(200);
    coalesced(300);
    expect(fn).not.toHaveBeenCalled();

    raf.flush();
    expect(fn).toHaveBeenCalledTimes(1);
    expect(fn).toHaveBeenCalledWith(300);
  });

  it("invokes again on a later frame", () => {
    const fn = jest.fn<(value: number) => void>();
    const coalesced = rafCoalesce(fn);

    coalesced(1);
    raf.flush();
    coalesced(2);
    raf.flush();

    expect(fn).toHaveBeenCalledTimes(2);
    expect(fn).toHaveBeenNthCalledWith(1, 1);
    expect(fn).toHaveBeenNthCalledWith(2, 2);
  });

  it("cancel() drops a pending invocation", () => {
    const fn = jest.fn<(value: number) => void>();
    const coalesced = rafCoalesce(fn);

    coalesced(42);
    coalesced.cancel();
    raf.flush();

    expect(fn).not.toHaveBeenCalled();
  });

  it("invokes synchronously when requestAnimationFrame is unavailable", () => {
    raf.restore();
    const original = global.requestAnimationFrame;
    // @ts-expect-error — deliberately removing the API to test the fallback.
    delete global.requestAnimationFrame;

    try {
      const fn = jest.fn<(value: number) => void>();
      const coalesced = rafCoalesce(fn);
      coalesced(7);
      // Fail open: an unavailable rAF must not silently swallow resizes.
      expect(fn).toHaveBeenCalledWith(7);
    } finally {
      global.requestAnimationFrame = original;
    }
  });
});

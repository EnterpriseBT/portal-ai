/**
 * #751: a workflow action that chains several requests runs once at a time.
 * A second call while one runs gets that run's promise instead of starting
 * another, so its non-deduplicated steps (a direct upload, a loop of
 * creates) never repeat.
 */
import { describe, it, expect, jest } from "@jest/globals";
import { renderHook } from "@testing-library/react";

import { useSingleFlight } from "../utils/use-single-flight.util";

const deferred = <T>() => {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

describe("useSingleFlight", () => {
  it("gives a concurrent call the running promise; fn runs once", async () => {
    const run = deferred<string>();
    const fn = jest.fn(() => run.promise);
    const { result } = renderHook(() => useSingleFlight(fn)[0]);

    const first = result.current();
    const second = result.current();
    expect(second).toBe(first);
    expect(fn).toHaveBeenCalledTimes(1);

    run.resolve("done");
    await expect(second).resolves.toBe("done");
  });

  it("runs fn again once the previous run has settled", async () => {
    const fn = jest.fn(async () => "ok");
    const { result } = renderHook(() => useSingleFlight(fn)[0]);

    await result.current();
    await result.current();
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("runs fn again after the previous run rejected", async () => {
    const fn = jest
      .fn<() => Promise<string>>()
      .mockRejectedValueOnce(new Error("boom"))
      .mockResolvedValueOnce("ok");
    const { result } = renderHook(() => useSingleFlight(fn)[0]);

    await expect(result.current()).rejects.toThrow("boom");
    await expect(result.current()).resolves.toBe("ok");
    expect(fn).toHaveBeenCalledTimes(2);
  });

  it("calls the latest fn, and keeps the wrapper stable across rerenders", async () => {
    const first = jest.fn(async () => "first");
    const second = jest.fn(async () => "second");
    const { result, rerender } = renderHook(
      ({ fn }: { fn: () => Promise<string> }) => useSingleFlight(fn)[0],
      { initialProps: { fn: first } }
    );
    const wrapper = result.current;

    rerender({ fn: second });
    expect(result.current).toBe(wrapper);
    await expect(result.current()).resolves.toBe("second");
    expect(first).not.toHaveBeenCalled();
  });

  it("passes its arguments through", async () => {
    const fn = jest.fn(async (a: number, b: string) => `${a}${b}`);
    const { result } = renderHook(() => useSingleFlight(fn)[0]);
    await expect(result.current(1, "x")).resolves.toBe("1x");
    expect(fn).toHaveBeenCalledWith(1, "x");
  });
});

// #753: a workflow reset supersedes the running action. Its result is
// discarded by the run token, so the next call must start a fresh run, not
// join the stale one.
describe("useSingleFlight release (#753)", () => {
  it("starts a new run after release(), even while the old one is pending", async () => {
    const stale = deferred<string>();
    const fn = jest
      .fn<() => Promise<string>>()
      .mockReturnValueOnce(stale.promise)
      .mockResolvedValueOnce("fresh");
    const { result } = renderHook(() => useSingleFlight(fn));
    const [run, release] = result.current;

    void run();
    release();
    await expect(run()).resolves.toBe("fresh");
    expect(fn).toHaveBeenCalledTimes(2);

    stale.resolve("stale");
  });

  it("keeps run and release stable across rerenders", () => {
    const { result, rerender } = renderHook(() =>
      useSingleFlight(async () => "ok")
    );
    const [run, release] = result.current;
    rerender();
    expect(result.current[0]).toBe(run);
    expect(result.current[1]).toBe(release);
  });
});

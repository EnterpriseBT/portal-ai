import { jest } from "@jest/globals";

import { renderHook, act } from "./test-utils";

import { useElapsed } from "../utils/use-elapsed.util";

// #279 — the app's first ticking clock. It drives the tool activity
// indicator's "18s" counter, so it must start only while a step is open and
// tear its interval down cleanly, or every portal session leaks a timer.

describe("useElapsed", () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("returns 0 when there is no start time", () => {
    const { result } = renderHook(() => useElapsed(null));
    expect(result.current).toBe(0);
  });

  it("registers no interval when there is no start time", () => {
    const spy = jest.spyOn(globalThis, "setInterval");
    renderHook(() => useElapsed(null));
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("counts whole seconds since the start time", () => {
    const start = Date.now();
    const { result } = renderHook(() => useElapsed(start));

    expect(result.current).toBe(0);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(1);

    act(() => {
      jest.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(2);
  });

  it("resets when the start time changes", () => {
    const start = Date.now();
    const { result, rerender } = renderHook(
      ({ startedAt }: { startedAt: number | null }) => useElapsed(startedAt),
      { initialProps: { startedAt: start } }
    );

    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(3);

    // A new step began — the counter restarts rather than continuing.
    rerender({ startedAt: Date.now() });
    expect(result.current).toBe(0);
  });

  it("returns to 0 when the start time clears", () => {
    const { result, rerender } = renderHook(
      ({ startedAt }: { startedAt: number | null }) => useElapsed(startedAt),
      { initialProps: { startedAt: Date.now() as number | null } }
    );

    act(() => {
      jest.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(2);

    rerender({ startedAt: null });
    expect(result.current).toBe(0);
  });

  it("clears its interval on unmount", () => {
    const clearSpy = jest.spyOn(globalThis, "clearInterval");
    const { unmount } = renderHook(() => useElapsed(Date.now()));

    unmount();

    expect(clearSpy).toHaveBeenCalled();
    clearSpy.mockRestore();
  });
});

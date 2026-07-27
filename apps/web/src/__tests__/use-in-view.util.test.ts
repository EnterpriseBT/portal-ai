import { jest } from "@jest/globals";
import { renderHook, act } from "@testing-library/react";

import { useInView, UI_INVIEW_MARGIN } from "../utils/use-in-view.util";

// A controllable IntersectionObserver so a test can drive intersect/leave.
interface FakeIO {
  cb: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  observe: jest.Mock;
  unobserve: jest.Mock;
  disconnect: jest.Mock;
}
let observers: FakeIO[] = [];

class MockIntersectionObserver {
  cb: IntersectionObserverCallback;
  options?: IntersectionObserverInit;
  observe = jest.fn();
  unobserve = jest.fn();
  disconnect = jest.fn();
  takeRecords = () => [];
  constructor(
    cb: IntersectionObserverCallback,
    options?: IntersectionObserverInit
  ) {
    this.cb = cb;
    this.options = options;
    observers.push(this as unknown as FakeIO);
  }
}

const fireLast = (isIntersecting: boolean) => {
  const o = observers[observers.length - 1];
  act(() => {
    o.cb(
      [{ isIntersecting } as IntersectionObserverEntry],
      o as unknown as IntersectionObserver
    );
  });
};

const originalIO = global.IntersectionObserver;

beforeEach(() => {
  observers = [];
  global.IntersectionObserver =
    MockIntersectionObserver as unknown as typeof IntersectionObserver;
});
afterEach(() => {
  global.IntersectionObserver = originalIO;
});

function makeRef() {
  return { current: document.createElement("div") };
}

describe("useInView (#271)", () => {
  it("starts false before the observer reports", () => {
    const { result } = renderHook(() => useInView(makeRef()));
    expect(result.current).toBe(false);
    expect(observers).toHaveLength(1);
  });

  it("flips true when the target intersects", () => {
    const { result } = renderHook(() => useInView(makeRef()));
    fireLast(true);
    expect(result.current).toBe(true);
  });

  it("flips back false when the target leaves", () => {
    const { result } = renderHook(() => useInView(makeRef()));
    fireLast(true);
    expect(result.current).toBe(true);
    fireLast(false);
    expect(result.current).toBe(false);
  });

  it("passes the provided root and rootMargin to the observer", () => {
    const root = document.createElement("div");
    renderHook(() => useInView(makeRef(), { root, rootMargin: "50px" }));
    expect(observers[0].options?.root).toBe(root);
    expect(observers[0].options?.rootMargin).toBe("50px");
  });

  it("defaults rootMargin to UI_INVIEW_MARGIN", () => {
    renderHook(() => useInView(makeRef()));
    expect(observers[0].options?.rootMargin).toBe(UI_INVIEW_MARGIN);
  });

  it("disconnects the observer on unmount", () => {
    const { unmount } = renderHook(() => useInView(makeRef()));
    const o = observers[0];
    unmount();
    expect(o.disconnect).toHaveBeenCalled();
  });

  it("fails open (true) when IntersectionObserver is unavailable", () => {
    global.IntersectionObserver =
      undefined as unknown as typeof IntersectionObserver;
    const { result } = renderHook(() => useInView(makeRef()));
    expect(result.current).toBe(true);
  });
});

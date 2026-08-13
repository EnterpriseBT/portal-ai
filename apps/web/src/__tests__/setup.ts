import "@testing-library/jest-dom";
import { configure } from "@testing-library/react";
import { TextEncoder, TextDecoder } from "util";

// Testing Library's async budget (#378). `waitFor` and friends default to
// 1000 ms — a number sized for an idle machine, not for a 239-suite parallel
// run. Under that contention a hook whose state settles in ~90 ms has been
// observed taking past the second, failing as a timeout with nothing actually
// broken.
//
// This is the missing half of #362/#363, which raised *Jest's* per-test
// timeout to 15 s for the same reason and left this one at its default. 5 s
// absorbs the contention while staying well inside that ceiling, so a genuine
// hang still fails promptly — and fails as the test rather than as a
// suite-level timeout.
configure({ asyncUtilTimeout: 5_000 });

// Polyfill for TextEncoder/TextDecoder (needed for Auth0)
global.TextEncoder = TextEncoder;
global.TextDecoder = TextDecoder as typeof global.TextDecoder;

// Extend Jest matchers with jest-dom
// This provides matchers like toBeInTheDocument(), toHaveClass(), etc.

// Mock window.matchMedia for Material-UI components
Object.defineProperty(window, "matchMedia", {
  writable: true,
  value: (query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addListener: () => {},
    removeListener: () => {},
    addEventListener: () => {},
    removeEventListener: () => {},
    dispatchEvent: () => false,
  }),
});

// Mock IntersectionObserver. Default: report the target as intersecting on
// observe(), so viewport-gated content (#271 lazy-mounted viz widgets) mounts
// by default in tests — matching the pre-lazy-mount always-rendered behavior.
// Tests that need to drive intersect/leave install their own controllable
// observer (see use-in-view.util.test.ts).
global.IntersectionObserver = class {
  cb: IntersectionObserverCallback;
  constructor(cb: IntersectionObserverCallback) {
    this.cb = cb;
  }
  disconnect() {}
  observe(target: Element) {
    this.cb(
      [{ isIntersecting: true, target } as IntersectionObserverEntry],
      this as unknown as IntersectionObserver
    );
  }
  takeRecords() {
    return [];
  }
  unobserve() {}
} as unknown as typeof IntersectionObserver;

// jsdom doesn't implement ResizeObserver; @tanstack/react-virtual uses it to
// re-measure scroll-container dimensions. A no-op stub leaves the virtualizer
// on its `initialRect` forever, which is what tests want — components supply a
// sane default viewport size so rows render deterministically.
global.ResizeObserver = class ResizeObserver {
  constructor(_cb: ResizeObserverCallback) {}
  observe() {}
  unobserve() {}
  disconnect() {}
} as unknown as typeof ResizeObserver;

// jsdom does not implement PointerEvent — testing-library's fireEvent
// silently falls back to a plain Event and drops clientX/Y/pointerId. Code
// that reads those off a synthetic onPointerDown/Move/Up event would then
// see `undefined` and produce NaN coordinates. Polyfilling with a subclass
// of MouseEvent preserves clientX/Y and lets pointer tests exercise the
// actual interaction paths.
if (typeof window !== "undefined" && !("PointerEvent" in window)) {
  class PolyfillPointerEvent extends MouseEvent {
    pointerId: number;
    pointerType: string;
    isPrimary: boolean;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 1;
      this.pointerType = init.pointerType ?? "mouse";
      this.isPrimary = init.isPrimary ?? true;
    }
  }
  (
    window as unknown as { PointerEvent: typeof PolyfillPointerEvent }
  ).PointerEvent = PolyfillPointerEvent;
  (
    global as unknown as { PointerEvent: typeof PolyfillPointerEvent }
  ).PointerEvent = PolyfillPointerEvent;
}

// setPointerCapture / releasePointerCapture aren't implemented on jsdom
// Elements either; stubs keep the drag handlers from throwing.
if (typeof Element !== "undefined") {
  if (!Element.prototype.setPointerCapture) {
    Element.prototype.setPointerCapture = () => {};
  }
  if (!Element.prototype.releasePointerCapture) {
    Element.prototype.releasePointerCapture = () => {};
  }
  if (!Element.prototype.hasPointerCapture) {
    Element.prototype.hasPointerCapture = () => false;
  }
}

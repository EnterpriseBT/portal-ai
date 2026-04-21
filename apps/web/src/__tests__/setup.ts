import "@testing-library/jest-dom";
import { TextEncoder, TextDecoder } from "util";

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

// Mock IntersectionObserver if needed by components
global.IntersectionObserver = class IntersectionObserver {
  constructor() {}
  disconnect() {}
  observe() {}
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

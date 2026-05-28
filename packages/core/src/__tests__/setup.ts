import "@testing-library/jest-dom";

import { TextEncoder, TextDecoder } from "node:util";
import { webcrypto } from "node:crypto";

// jsdom (the Jest test environment) does not expose TextEncoder /
// TextDecoder / Web Crypto on the global. Polyfill from Node so that
// utilities that use the Web Crypto API in production (e.g.
// `probe-hash.util.ts`) work under test.
if (typeof globalThis.TextEncoder === "undefined") {
  Object.assign(globalThis, { TextEncoder, TextDecoder });
}
// jsdom defines a minimal `crypto` (randomUUID only) on global; replace
// with Node's full webcrypto so `crypto.subtle.digest` is available.
if (
  typeof globalThis.crypto === "undefined" ||
  typeof globalThis.crypto.subtle === "undefined"
) {
  Object.defineProperty(globalThis, "crypto", {
    value: webcrypto,
    configurable: true,
  });
}

// Extend Jest matchers with jest-dom
// This provides matchers like toBeInTheDocument(), toHaveClass(), etc.

// Optional: Add custom matchers or global test utilities here
// Example:
// global.customTestUtil = () => { ... };

// Optional: Mock window.matchMedia if components use media queries
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

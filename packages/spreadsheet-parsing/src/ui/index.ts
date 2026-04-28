/**
 * `@portalai/spreadsheet-parsing/ui` — browser-only subpath.
 *
 * Landing zone for any exports that depend on browser-only APIs (DOM,
 * `window`, `globalThis.crypto.subtle`, React hooks, etc.). Anything here
 * must NOT run in Node without a DOM shim, and must NOT be re-exported from
 * the main entry (which stays cross-compatible).
 *
 * See `packages/spreadsheet-parsing/README.md` for the full three-subpath
 * convention.
 */

// Empty today — future browser-only helpers go here.
export {};

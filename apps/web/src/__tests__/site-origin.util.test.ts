/**
 * Marketing-site origin in the app (#506).
 *
 * The login screen's consent copy links to the public Terms and Privacy pages,
 * which live on the marketing site at a per-env origin. The origin is
 * env-derived (a `VITE_SITE_URL` build var), mirroring the contact addresses:
 * `import.meta.env` is Vite-only and per-module, so the resolution is tested as
 * the pure function it was factored into, and the exported URLs are asserted
 * for the properties that must hold however the environment resolves.
 */
import {
  DEFAULT_SITE_ORIGIN,
  resolveSiteOrigin,
  SITE_ORIGIN,
  TERMS_URL,
  PRIVACY_URL,
} from "../utils/site-origin.util";

describe("resolveSiteOrigin (#506)", () => {
  it("uses a configured origin", () => {
    expect(resolveSiteOrigin("https://site-dev.portalsai.io")).toBe(
      "https://site-dev.portalsai.io"
    );
  });

  it("falls back to the prod origin when unset", () => {
    // An unset var must still link to real, published pages — not a dead URL.
    expect(resolveSiteOrigin(undefined)).toBe(DEFAULT_SITE_ORIGIN);
  });

  it("treats blank and whitespace-only values as unset", () => {
    expect(resolveSiteOrigin("")).toBe(DEFAULT_SITE_ORIGIN);
    expect(resolveSiteOrigin("   ")).toBe(DEFAULT_SITE_ORIGIN);
  });

  it("trims trailing slashes so the path join is exact", () => {
    // A configured origin with a trailing slash would otherwise produce a
    // double slash in `${origin}/terms/`.
    expect(resolveSiteOrigin("https://www.portalsai.io/")).toBe(
      "https://www.portalsai.io"
    );
    expect(resolveSiteOrigin("https://www.portalsai.io///")).toBe(
      "https://www.portalsai.io"
    );
  });
});

describe("site URLs (#506)", () => {
  it("imports cleanly outside a Vite build and defaults to prod", () => {
    // `import.meta.env` does not exist under jest; the module must resolve
    // rather than throwing on property access.
    expect(SITE_ORIGIN).toBe(DEFAULT_SITE_ORIGIN);
    expect(TERMS_URL).toBe("https://www.portalsai.io/terms/");
    expect(PRIVACY_URL).toBe("https://www.portalsai.io/privacy/");
  });

  it("never produces a double slash before the path", () => {
    for (const url of [TERMS_URL, PRIVACY_URL]) {
      expect(url).not.toMatch(/[^:]\/\//);
    }
  });
});

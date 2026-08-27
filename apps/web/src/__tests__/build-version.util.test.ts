import { resolveBuildVersion } from "../utils/build-version.util";

// ── Build identity resolution (#454) ────────────────────────────────
//
// version.json is polled by useAppVersion to prompt a reload when a new
// build is deployed. It used to carry `crypto.randomUUID()`, minted per
// build INVOCATION, which meant rebuilding an unchanged commit told every
// connected user to reload for nothing. The identity is now the commit.

describe("resolveBuildVersion", () => {
  it("should return VITE_APP_SHA when it is set", () => {
    expect(resolveBuildVersion({ VITE_APP_SHA: "abc123" })).toBe("abc123");
  });

  it("should trim surrounding whitespace from VITE_APP_SHA", () => {
    expect(resolveBuildVersion({ VITE_APP_SHA: "  abc123  " })).toBe("abc123");
  });

  it("should fall back to 'dev' when VITE_APP_SHA is unset", () => {
    expect(resolveBuildVersion({})).toBe("dev");
  });

  it("should fall back to 'dev' when VITE_APP_SHA is empty", () => {
    expect(resolveBuildVersion({ VITE_APP_SHA: "" })).toBe("dev");
  });

  it("should fall back to 'dev' when VITE_APP_SHA is only whitespace", () => {
    expect(resolveBuildVersion({ VITE_APP_SHA: "   " })).toBe("dev");
  });

  // The property the old randomUUID implementation violated, and the whole
  // reason a cached build is safe: identical inputs must yield an identical
  // version, because an identical bundle has no new version to reload for.
  it("should be deterministic across calls with the same environment", () => {
    const env = { VITE_APP_SHA: "abc123" };
    expect(resolveBuildVersion(env)).toBe(resolveBuildVersion(env));
    expect(resolveBuildVersion({})).toBe(resolveBuildVersion({}));
  });
});

import { THEME_MAP } from "@portalai/core/ui";

import { buildSandboxTheme } from "../sandbox-theme.util";

describe("buildSandboxTheme", () => {
  it("maps the brand (light) theme to serializable sandbox tokens", () => {
    const t = buildSandboxTheme(THEME_MAP.brand);
    expect(t.mode).toBe("light");
    expect(t.background).toBe("#ffffff");
    expect(t.text).toBe("#1a1630");
    expect(t.fontFamily).toContain("Exo 2");
    expect(t.monospaceFontFamily).toContain("Space Mono");
    // [primary, secondary, success, warning, error, info] mains, in order.
    expect(t.categorical).toEqual([
      "#5b3fc0",
      "#185fa5",
      "#1a7a4a",
      "#d4900e",
      "#dc2626",
      "#185fa5",
    ]);
  });

  it("maps the dark theme's mode", () => {
    const t = buildSandboxTheme(THEME_MAP["brand.dark"]);
    expect(t.mode).toBe("dark");
    expect(t.categorical).toHaveLength(6);
  });

  it("produces plain-JSON-serializable output (postMessage-safe)", () => {
    const t = buildSandboxTheme(THEME_MAP.brand);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });
});

// @ts-expect-error -- web has no d3 type declarations (the sandbox loads d3
// untyped, #268); this test only reads the symbol exports.
import * as d3 from "d3";
import { THEME_MAP } from "@portalai/core/ui";

import {
  buildSandboxTheme,
  SANDBOX_DASHES,
  SANDBOX_SYMBOLS,
} from "../sandbox-theme.util";

describe("buildSandboxTheme", () => {
  it("maps the brand (light) theme to serializable sandbox tokens", () => {
    const t = buildSandboxTheme(THEME_MAP.brand);
    expect(t.mode).toBe("light");
    expect(t.text).toBe("#1a1630");
    expect(t.fontFamily).toContain("Exo 2");
    expect(t.monospaceFontFamily).toContain("Space Mono");
  });

  it.each(["brand", "brand.dark"] as const)(
    "%s: series colours are the theme's dataViz palette (#1022)",
    (name) => {
      const { palette } = THEME_MAP[name];
      expect(buildSandboxTheme(THEME_MAP[name]).categorical).toEqual(
        palette.dataViz.categorical
      );
    }
  );

  it.each(["brand", "brand.dark"] as const)(
    "%s: the background is the figure's surface, background.paper (#1022)",
    (name) => {
      expect(buildSandboxTheme(THEME_MAP[name]).background).toBe(
        THEME_MAP[name].palette.background.paper
      );
    }
  );

  it("maps the dark theme's mode", () => {
    expect(buildSandboxTheme(THEME_MAP["brand.dark"]).mode).toBe("dark");
  });

  it("offers dashes to tell lines apart, solid first", () => {
    const t = buildSandboxTheme(THEME_MAP.brand);
    expect(t.dashes).toEqual(SANDBOX_DASHES);
    expect(t.dashes[0]).toBe("none");
    expect(new Set(t.dashes).size).toBe(t.dashes.length);
  });

  it("offers marker symbols that exist on d3", () => {
    const t = buildSandboxTheme(THEME_MAP.brand);
    expect(t.symbols).toEqual(SANDBOX_SYMBOLS);
    for (const name of t.symbols) {
      expect(typeof (d3 as unknown as Record<string, unknown>)[name]).toBe(
        "object"
      );
    }
  });

  it("produces plain-JSON-serializable output (postMessage-safe)", () => {
    const t = buildSandboxTheme(THEME_MAP.brand);
    expect(JSON.parse(JSON.stringify(t))).toEqual(t);
  });
});

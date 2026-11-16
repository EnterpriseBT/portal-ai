import { describe, it, expect } from "@jest/globals";

import { runInNewContext } from "node:vm";

import {
  DARK_THEME_NAME,
  LIGHT_THEME_NAME,
  THEME_STORAGE_KEY as CORE_KEY,
} from "@portalai/core/constants";

import {
  THEME_STORAGE_KEY,
  nextTheme,
  pressedFor,
  resolveTheme,
  themeHeadScript,
  titleFor,
  toThemeName,
} from "../theme-toggle.js";

// #798: the theme toggle is an APG toggle button ("Dark theme", aria-pressed).
// Its state logic lives here so it's tested; the head script that resolves
// the theme before first paint must agree with `resolveTheme`.

describe("theme toggle", () => {
  it("shares the app's storage key and encoding, from core", () => {
    expect(THEME_STORAGE_KEY).toBe(CORE_KEY);
    expect(toThemeName("light")).toBe(LIGHT_THEME_NAME);
    expect(toThemeName("dark")).toBe(DARK_THEME_NAME);
  });

  it("titles the toggle with the action a click takes", () => {
    expect(titleFor("light")).toBe("Switch to dark theme");
    expect(titleFor("dark")).toBe("Switch to light theme");
  });

  it("flips between light and dark", () => {
    expect(nextTheme("light")).toBe("dark");
    expect(nextTheme("dark")).toBe("light");
  });

  it("is pressed exactly when the dark theme is on", () => {
    expect(pressedFor("dark")).toBe("true");
    expect(pressedFor("light")).toBe("false");
  });

  it("resolves a stored choice like the head script does", () => {
    expect(resolveTheme(JSON.stringify("brand.dark"), false)).toBe("dark");
    expect(resolveTheme(JSON.stringify("brand"), true)).toBe("light");
  });

  it("falls back to the system preference with no or an unknown choice", () => {
    expect(resolveTheme(null, true)).toBe("dark");
    expect(resolveTheme(null, false)).toBe("light");
    expect(resolveTheme(JSON.stringify("sepia"), true)).toBe("dark");
  });

  it("treats an unreadable stored value as light, like the head script", () => {
    expect(resolveTheme("{not json", true)).toBe("light");
  });

  it("round-trips every theme through the stored encoding", () => {
    for (const theme of ["light", "dark"] as const) {
      expect(resolveTheme(JSON.stringify(toThemeName(theme)), false)).toBe(
        theme
      );
    }
  });
});

// #798 review: the head script that resolves the theme before first paint is
// generated from resolveTheme, so the two can't drift. Run it as the browser
// would and compare.
describe("theme head script", () => {
  const run = (stored: string | null, prefersDark: boolean, throws = false) => {
    const attrs: Record<string, string> = {};
    const reads: string[] = [];
    runInNewContext(themeHeadScript(), {
      document: {
        documentElement: {
          setAttribute: (k: string, v: string) => (attrs[k] = v),
        },
      },
      localStorage: {
        getItem: (k: string) => {
          reads.push(k);
          if (throws) throw new Error("blocked");
          return stored;
        },
      },
      window: { matchMedia: () => ({ matches: prefersDark }) },
    });
    return { attrs, reads };
  };

  it.each([
    [JSON.stringify("brand.dark"), false],
    [JSON.stringify("brand"), true],
    [null, true],
    [null, false],
    [JSON.stringify("sepia"), true],
    ["{not json", true],
  ])(
    "sets data-theme as resolveTheme does (stored %s, prefers dark %s)",
    (stored, dark) => {
      const { attrs, reads } = run(stored, dark);
      expect(attrs["data-theme"]).toBe(resolveTheme(stored, dark));
      expect(reads).toEqual([CORE_KEY]);
    }
  );

  it("marks the page as scripted before paint, so the toggle shows without reflow", () => {
    expect(run(null, false).attrs["data-js"]).toBe("");
  });

  it("falls back to light when storage throws (private mode)", () => {
    expect(run(null, true, true).attrs["data-theme"]).toBe("light");
  });
});

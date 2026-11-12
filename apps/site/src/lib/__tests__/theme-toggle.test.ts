import { describe, it, expect } from "@jest/globals";

import {
  THEME_STORAGE_KEY,
  nextTheme,
  pressedFor,
  resolveTheme,
  toThemeName,
} from "../theme-toggle.js";

// #798: the theme toggle is an APG toggle button ("Dark theme", aria-pressed).
// Its state logic lives here so it's tested; the head script that resolves
// the theme before first paint must agree with `resolveTheme`.

describe("theme toggle", () => {
  it("shares the app's storage key and encoding", () => {
    expect(THEME_STORAGE_KEY).toBe("portalai-theme");
    expect(toThemeName("light")).toBe("brand");
    expect(toThemeName("dark")).toBe("brand.dark");
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

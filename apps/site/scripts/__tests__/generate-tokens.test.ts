/**
 * Theme → CSS token bridge (#311 slice 6).
 *
 * Run against the REAL theme JSONs, not a fixture: the point of the bridge
 * is that it survives whatever core's designers put in those files. A test
 * against a hand-made theme object would pass while the real one produced
 * nothing.
 */

import { describe, it, expect } from "@jest/globals";

// Imported from the plain .mjs build script — `allowJs` makes this typed.
import { generateTokensCss, readThemes } from "../generate-tokens.mjs";

const themes = readThemes();
const css: string = generateTokensCss(themes);

/** The declarations inside one `:root[data-theme="…"]` block. */
function block(theme: "light" | "dark"): string {
  const match = css.match(
    new RegExp(`:root\\[data-theme="${theme}"\\]\\s*\\{([^}]*)\\}`)
  );
  expect(match).not.toBeNull();
  return match![1];
}

describe("generateTokensCss", () => {
  // ── case 1 — both themes present, from the real JSONs ──────────────

  it("emits a block for each theme, both non-empty", () => {
    for (const theme of ["light", "dark"] as const) {
      const declarations = block(theme).match(/--[\w-]+:/g) ?? [];
      expect(declarations.length).toBeGreaterThan(20);
    }
  });

  it("the two themes differ — a copy-paste bug would make them identical", () => {
    expect(block("light")).not.toBe(block("dark"));
  });

  // ── case 2 — the token families the stylesheets rely on ────────────

  it.each(["light", "dark"] as const)(
    "%s carries palette, font, spacing, radius, and breakpoint tokens",
    (theme) => {
      const b = block(theme);
      expect(b).toMatch(/--color-primary-main:\s*#/);
      expect(b).toMatch(/--color-background-default:\s*/);
      expect(b).toMatch(/--color-text-primary:\s*/);
      expect(b).toMatch(/--font-family-body:\s*/);
      expect(b).toMatch(/--font-family-heading:\s*/);
      expect(b).toMatch(/--space-unit:\s*\d+px/);
      expect(b).toMatch(/--radius-base:\s*\d+px/);
      expect(b).toMatch(/--bp-md:\s*\d+px/);
    }
  );

  it("carries the light and dark backgrounds actually declared in core", () => {
    expect(block("light")).toContain(themes.light.palette.background.default);
    expect(block("dark")).toContain(themes.dark.palette.background.default);
  });

  it("names tokens in kebab-case — no camelCase leaked from the JSON", () => {
    const names = css.match(/--[\w-]+(?=:)/g) ?? [];
    expect(names.length).toBeGreaterThan(0);
    expect(names.filter((n) => /[A-Z]/.test(n))).toEqual([]);
  });

  // ── case 3 — deterministic ─────────────────────────────────────────

  it("is deterministic — same input, byte-identical output", () => {
    expect(generateTokensCss(readThemes())).toBe(css);
  });

  it("marks the output as generated so nobody hand-edits it", () => {
    expect(css).toMatch(/GENERATED/);
  });
});

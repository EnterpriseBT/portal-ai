/**
 * Font `src` ordering guard (#311).
 *
 * `build:fonts` emits a `.woff2` beside every `.ttf`, but the bytes only
 * help if the stylesheet asks for them FIRST — a browser takes the first
 * `src` format it supports. This is ~670 kB of first-paint weight on the
 * public marketing site, and an edit to `fonts.scss` that reorders or drops
 * a `woff2` entry is silent: everything still renders, just slower.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const FONTS_SCSS = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../assets/scss/fonts.scss"
);
const FONTS_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../assets/fonts"
);

const scss = fs.readFileSync(FONTS_SCSS, "utf8");

/** Each `@font-face { … }` block's body. */
const faces = [...scss.matchAll(/@font-face\s*\{([^}]*)\}/g)].map((m) => m[1]);

describe("fonts.scss", () => {
  it("declares every @font-face with a src list", () => {
    expect(faces.length).toBeGreaterThan(0);
    for (const face of faces) {
      expect(face).toMatch(/src:/);
    }
  });

  it("asks for woff2 before truetype in every face", () => {
    for (const face of faces) {
      const firstWoff2 = face.indexOf('format("woff2")');
      const firstTtf = face.indexOf('format("truetype")');
      expect(firstWoff2).toBeGreaterThan(-1);
      expect(firstWoff2).toBeLessThan(firstTtf);
    }
  });

  it("keeps a truetype fallback for every woff2 it references", () => {
    const woff2 = [...scss.matchAll(/url\("\.\.\/fonts\/([^"]+)\.woff2"\)/g)];
    expect(woff2.length).toBeGreaterThan(0);
    for (const [, name] of woff2) {
      expect(scss).toContain(`url("../fonts/${name}.ttf")`);
      // …and the TTF `build:fonts` converts from must actually exist.
      expect(fs.existsSync(path.join(FONTS_DIR, `${name}.ttf`))).toBe(true);
    }
  });

  it("keeps font-display: swap on every face (no invisible text)", () => {
    for (const face of faces) {
      expect(face).toMatch(/font-display:\s*swap/);
    }
  });
});

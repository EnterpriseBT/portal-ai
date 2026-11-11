/**
 * Convention guard (#996): the RegionEditor's sheet canvas takes every
 * colour from the theme.
 *
 * Its colours live in `palette.sheet` (both theme JSONs) and reach the DOM
 * through the theme's `[data-sheet-part]` rules, so Brand Dark and the
 * contrast test cover them. A hex or rgba literal in these files is a colour
 * the theme can't see: it renders light in the dark theme and no test
 * checks its contrast. The entity colour is the one runtime value, passed in
 * as a `data-entity` slot the theme maps to a mode-specific colour.
 */

import { readdirSync, readFileSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const editor = join(here, "..", "modules", "RegionEditor");

/** Every component and util in the module, tests and stories aside: the
 *  canvas and the panels, legend, chips and banners around it (#996). */
const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "stories"
        ? []
        : sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) ? [path.slice(editor.length + 1)] : [];
  });
const FILES = sourceFiles(editor);

/** A quoted hex colour, an rgb()/rgba() call, or a hex alpha suffix on an
 *  interpolated colour (`${color}33`). `#795` in a comment isn't quoted, so
 *  issue references don't match. */
const COLOUR_LITERAL =
  /["'`]#[0-9a-fA-F]{3,8}\b|\brgba?\(|\$\{[^}]+\}[0-9a-fA-F]{2}\b/;

describe("sheet canvas colours come from the theme (#996)", () => {
  it.each(FILES)("%s has no colour literal", (file) => {
    const lines = readFileSync(join(editor, file), "utf8").split("\n");
    const hits = lines
      .map((line, i) => ({ line: i + 1, text: line.trim() }))
      .filter(({ text }) => COLOUR_LITERAL.test(text));
    expect(hits).toEqual([]);
  });

  it("the pattern catches the literals it exists for", () => {
    expect(COLOUR_LITERAL.test('backgroundColor: "#fff",')).toBe(true);
    expect(COLOUR_LITERAL.test('color: "rgba(0,0,0,0.6)",')).toBe(true);
    expect(COLOUR_LITERAL.test("background: `${color}33`")).toBe(true);
    expect(COLOUR_LITERAL.test("// a #795 reference")).toBe(false);
  });

  it("scans the whole module", () => {
    expect(FILES).toEqual(
      expect.arrayContaining([
        "SheetCanvas.component.tsx",
        "DriftBanner.component.tsx",
        "utils/region-editor-colors.util.ts",
      ])
    );
  });
});

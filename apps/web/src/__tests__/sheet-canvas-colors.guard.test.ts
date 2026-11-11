/**
 * Convention guard (#996): the RegionEditor's sheet canvas takes every
 * colour from the theme.
 *
 * Its colours live in `palette.sheet` (both theme JSONs) and reach the DOM
 * through the theme's `[data-sheet-part]` rules, so Brand Dark and the
 * contrast test cover them. A hex or rgba literal in these files is a colour
 * the theme can't see: it renders light in the dark theme and no test
 * checks its contrast. The entity colour is the one runtime value, passed in
 * as `--region-color`.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const here = dirname(fileURLToPath(import.meta.url));
const editor = join(here, "..", "modules", "RegionEditor");

const FILES = [
  "SheetCanvas.component.tsx",
  "RegionOverlay.component.tsx",
  "RegionConfigurationPanel.component.tsx",
  "utils/region-editor-decorations.util.ts",
];

/** A quoted hex colour, or an rgb()/rgba() call. `#795` in a comment isn't
 *  quoted, so issue references don't match. */
const COLOUR_LITERAL = /["'`]#[0-9a-fA-F]{3,8}\b|\brgba?\(/;

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
    expect(COLOUR_LITERAL.test("// a #795 reference")).toBe(false);
  });
});

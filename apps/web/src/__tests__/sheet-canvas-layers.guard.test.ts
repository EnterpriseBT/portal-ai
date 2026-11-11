/**
 * Convention guard (#1005): every z-index in the RegionEditor reads the
 * `SHEET_LAYER` scale.
 *
 * CSS `z-index` takes integers only. A fractional value cast past tsc
 * (`4.5 as unknown as number`) is dropped by the browser and computes to
 * `auto`, so an editable pivot × pivot block fell under the selected region
 * and a click on it moved the region instead. Nothing fails at runtime; the
 * control just looks clickable and isn't. Reading one named integer scale
 * keeps the order in one place and rules the casts out.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { blankLiterals, sourceFiles } from "./guard-source.util";

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, "..", "modules", "RegionEditor");
const SCALE_FILE = join(moduleDir, "utils", "sheet-layers.util.ts");

/** `zIndex: <expr>` up to the property's comma, across lines (a ternary wraps). */
const Z_INDEX = /\bzIndex\s*:\s*([^,}]+)/g;

function violations(): string[] {
  return sourceFiles(moduleDir)
    .filter((path) => path !== SCALE_FILE)
    .flatMap((path) => {
      const source = blankLiterals(readFileSync(path, "utf8"));
      return [...source.matchAll(Z_INDEX)]
        .filter(([, expr]) => {
          const reads = expr.match(/\bSHEET_LAYER\.\w+/g) ?? [];
          // Strip the scale reads; anything numeric left is a literal.
          const rest = expr.replace(/\bSHEET_LAYER\.\w+/g, "");
          return reads.length === 0 || /\d/.test(rest) || /\bas\b/.test(rest);
        })
        .map(
          ([match]) =>
            `${relative(moduleDir, path)}: ${match.replace(/\s+/g, " ").trim()}`
        );
    });
}

describe("sheet canvas layers guard (#1005)", () => {
  test("every zIndex in the RegionEditor reads SHEET_LAYER", () => {
    expect(violations()).toEqual([]);
  });

  test("the guard sees the module (not vacuously green)", () => {
    const files = sourceFiles(moduleDir).map((p) => readFileSync(p, "utf8"));
    expect(files.some((s) => /\bzIndex\s*:/.test(s))).toBe(true);
  });
});

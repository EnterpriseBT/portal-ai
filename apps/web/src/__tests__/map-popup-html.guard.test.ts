import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative } from "node:path";
import { fileURLToPath } from "node:url";

// #1016: map popups rendered record values as HTML (`popup.setHTML`), a
// stored XSS any record writer or connector sync could plant. A popup is
// text now (`popupText` + `setText`). This fails CI on any HTML sink in the
// map module, so the next popup change can't bring it back.

const here = dirname(fileURLToPath(import.meta.url));
const MAP_DIR = join(here, "../modules/MapWidget");
const SINKS = [/\.setHTML\s*\(/, /dangerouslySetInnerHTML/, /\.innerHTML\s*=/];

const sourceFiles = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "stories"
        ? []
        : sourceFiles(path);
    }
    return /\.(ts|tsx)$/.test(name) ? [path] : [];
  });

describe("map popup HTML guard (#1016)", () => {
  it("finds the map module's source files", () => {
    expect(sourceFiles(MAP_DIR).length).toBeGreaterThan(3);
  });

  it("has no HTML sink in the map module", () => {
    const hits = sourceFiles(MAP_DIR).flatMap((file) =>
      readFileSync(file, "utf8")
        .split("\n")
        .map((line, i) => ({ line, i }))
        .filter(({ line }) => SINKS.some((re) => re.test(line)))
        .map(
          ({ line, i }) => `${relative(MAP_DIR, file)}:${i + 1}: ${line.trim()}`
        )
    );
    expect(hits).toEqual([]);
  });
});

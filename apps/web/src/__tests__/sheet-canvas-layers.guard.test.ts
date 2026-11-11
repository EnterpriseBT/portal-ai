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
 *
 * The rule, over each module file with comments removed:
 * - every `zIndex` is a `zIndex:` property (no shorthand `{ zIndex }`, no
 *   variable a value could hide in);
 * - its value is `SHEET_LAYER.<layer>`, or a ternary whose branches are;
 * - no string spells a z-index (`"zIndex"`, CSS-in-string `z-index`).
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { blankLiterals, sourceFiles } from "./guard-source.util";

const here = dirname(fileURLToPath(import.meta.url));
const moduleDir = join(here, "..", "modules", "RegionEditor");
const SCALE_FILE = join(moduleDir, "utils", "sheet-layers.util.ts");

/** The source with comment bodies blanked and strings kept. */
function stripComments(source: string): string {
  const out = source.split("");
  let i = 0;
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && (next === "/" || next === "*")) {
      const close = next === "/" ? "\n" : "*/";
      const end = source.indexOf(close, i + 2);
      const stop = end === -1 ? source.length : end + (next === "*" ? 2 : 0);
      for (let j = i; j < stop; j++) if (out[j] !== "\n") out[j] = " ";
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") j++;
        j++;
      }
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** The expression from `from` to its top-level `,`, `}` or `)`. */
function expressionAt(source: string, from: number): string {
  let depth = 0;
  for (let i = from; i < source.length; i++) {
    const c = source[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") {
      if (depth === 0) return source.slice(from, i);
      depth--;
    } else if (c === "," && depth === 0) return source.slice(from, i);
  }
  return source.slice(from);
}

/** `SHEET_LAYER.<layer>`, or `cond ? <ok> : <ok>`, in optional parens. */
function readsScale(expression: string): boolean {
  let expr = expression.trim();
  while (expr.startsWith("(") && expr.endsWith(")")) {
    expr = expr.slice(1, -1).trim();
  }
  if (/^SHEET_LAYER\.\w+$/.test(expr)) return true;
  let depth = 0;
  let question = -1;
  let nested = 0;
  for (let i = 0; i < expr.length; i++) {
    const c = expr[i];
    if (c === "(" || c === "[" || c === "{") depth++;
    else if (c === ")" || c === "]" || c === "}") depth--;
    else if (depth === 0 && c === "?") {
      if (question === -1) question = i;
      else nested++;
    } else if (depth === 0 && c === ":" && question !== -1) {
      if (nested > 0) nested--;
      else {
        const condition = expr.slice(0, question);
        return (
          !/\bas\b|\d/.test(condition) &&
          readsScale(expr.slice(question + 1, i)) &&
          readsScale(expr.slice(i + 1))
        );
      }
    }
  }
  return false;
}

/** Every way `source` breaks the rule. */
function refusals(source: string): string[] {
  const code = stripComments(source);
  const blanked = blankLiterals(code);
  const found = [...code.matchAll(/z-index|["'`]zIndex["'`]/gi)].map(
    (m) => `z-index in a string (${m[0]})`
  );
  for (const match of blanked.matchAll(/\bzIndex\b/g)) {
    const after = match.index + match[0].length;
    const colon = /^\s*:/.exec(blanked.slice(after));
    if (!colon) {
      found.push("zIndex not written as a property");
      continue;
    }
    const expression = expressionAt(blanked, after + colon[0].length);
    if (!readsScale(expression)) {
      found.push(`zIndex: ${expression.replace(/\s+/g, " ").trim()}`);
    }
  }
  return found;
}

function violations(): string[] {
  return sourceFiles(moduleDir)
    .filter((path) => path !== SCALE_FILE)
    .flatMap((path) =>
      refusals(readFileSync(path, "utf8")).map(
        (refusal) => `${relative(moduleDir, path)}: ${refusal}`
      )
    );
}

describe("sheet canvas layers guard (#1005)", () => {
  test("every zIndex in the RegionEditor reads SHEET_LAYER", () => {
    expect(violations()).toEqual([]);
  });

  test("the guard sees the module (not vacuously green)", () => {
    const files = sourceFiles(moduleDir).map((p) => readFileSync(p, "utf8"));
    expect(files.some((s) => /\bzIndex\s*:/.test(s))).toBe(true);
  });

  test.each([
    ["a fractional cast", "zIndex: 4.5 as unknown as number,"],
    ["a literal branch", "zIndex: on ? SHEET_LAYER.region : 5,"],
    ["a call hiding a literal", "zIndex: Math.max(SHEET_LAYER.region, 4.5),"],
    ["a shorthand", "sx={{ zIndex }}"],
    ["a quoted key", 'style={{ "zIndex": 4 }}'],
    ["CSS in a string", "css`z-index: 4.5;`"],
  ])("the rule refuses %s", (_label, snippet) => {
    expect(refusals(snippet)).not.toEqual([]);
  });

  test("the rule accepts a scale read and a ternary of them", () => {
    expect(readsScale("SHEET_LAYER.region")).toBe(true);
    expect(
      readsScale("selected ? SHEET_LAYER.regionSelected : SHEET_LAYER.region")
    ).toBe(true);
  });
});

import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * Source-parsing helpers shared by the web guard tests (#783, #970). Not a
 * test file itself: Jest only collects `*.test.ts(x)`.
 */
/**
 * The source with every string, template literal and comment body replaced
 * by spaces (same length), so a brace or paren inside one can't throw the
 * parser off and a call inside one isn't counted.
 */
export function blankLiterals(source: string): string {
  const out = source.split("");
  let i = 0;
  const blank = (from: number, to: number) => {
    for (let j = from; j < to; j++) if (out[j] !== "\n") out[j] = " ";
  };
  while (i < source.length) {
    const c = source[i];
    const next = source[i + 1];
    if (c === "/" && next === "/") {
      const end = source.indexOf("\n", i);
      const stop = end === -1 ? source.length : end;
      blank(i, stop);
      i = stop;
    } else if (c === "/" && next === "*") {
      const end = source.indexOf("*/", i + 2);
      const stop = end === -1 ? source.length : end + 2;
      blank(i, stop);
      i = stop;
    } else if (c === '"' || c === "'" || c === "`") {
      let j = i + 1;
      while (j < source.length && source[j] !== c) {
        if (source[j] === "\\") j++;
        j++;
      }
      blank(i + 1, j);
      i = j + 1;
    } else {
      i++;
    }
  }
  return out.join("");
}

/** The balanced `(…)` argument list whose `(` is at `open`. */
export function argumentsAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    const c = source[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if ((c === ")" || c === "}" || c === "]") && --depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/** Top-level comma-separated pieces of an argument list. */
export function topLevelArgs(args: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < args.length; i++) {
    const c = args[i];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") depth--;
    else if (c === "," && depth === 0) {
      parts.push(args.slice(start, i));
      start = i + 1;
    }
  }
  parts.push(args.slice(start));
  return parts.map((p) => p.trim()).filter(Boolean);
}

/** Every `.ts`/`.tsx` under `dir`, skipping `__tests__` and `stories`. */
export function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "stories"
        ? []
        : sourceFiles(path);
    }
    return /\.tsx?$/.test(path) ? [path] : [];
  });
}

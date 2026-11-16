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

/** Names bound from `mutate` / `mutateAsync` by object destructuring. */
function destructuredMutateNames(blanked: string): string[] {
  const names = new Set<string>();
  for (const m of blanked.matchAll(
    /[{,]\s*(mutate|mutateAsync)\b(?:\s*:\s*([A-Za-z_$][\w$]*))?\s*(?=[,}=])/g
  )) {
    names.add(m[2] ?? m[1]!);
  }
  return [...names];
}

export interface MutationCall {
  /** `mutate`, `mutateAsync`, or the name destructured from either. */
  name: string;
  /** Offset of the call in the source. */
  index: number;
  /** The call's second (options) argument, blanked; undefined without one. */
  options: string | undefined;
}

/**
 * Every `.mutate(…)` / `.mutateAsync(…)` call in `source`, and every call
 * through a name destructured from either (#970, #985). The options are taken
 * from the blanked source, so a string mentioning a call never matches.
 */
export function mutationCalls(source: string): MutationCall[] {
  const blanked = blankLiterals(source);
  const names = destructuredMutateNames(blanked);
  const calls: MutationCall[] = [];
  for (const call of blanked.matchAll(
    /(?:\.(?:mutate|mutateAsync)|(?<![\w$.])[A-Za-z_$][\w$]*)\(/g
  )) {
    const name = call[0].replace(/^\./, "").slice(0, -1);
    const viaMember = call[0].startsWith(".");
    if (!viaMember && !names.includes(name)) continue;
    const args = topLevelArgs(
      argumentsAt(blanked, call.index! + call[0].length - 1)
    );
    calls.push({ name, index: call.index!, options: args[1] });
  }
  return calls;
}

/** The expression after `=>` at `from`: a `{…}` block, or up to a `;`. */
function arrowBody(blanked: string, from: number): string {
  let i = from;
  while (/\s/.test(blanked[i] ?? "")) i++;
  if (blanked[i] === "{") return argumentsAt(blanked, i);
  let depth = 0;
  for (let j = i; j < blanked.length; j++) {
    const c = blanked[j];
    if (c === "(" || c === "{" || c === "[") depth++;
    else if (c === ")" || c === "}" || c === "]") {
      if (--depth < 0) return blanked.slice(i, j);
    } else if (c === ";" && depth === 0) return blanked.slice(i, j);
  }
  return blanked.slice(i);
}

/**
 * The bodies of the functions `source` declares by name: `function name(…)`,
 * and `const name = …` bound to an arrow function or a `useCallback(…)`
 * (bare or `React.useCallback`).
 * Lets a guard follow a callback passed or called by name (#985:
 * `onSuccess: invalidateTags`).
 */
export function localFunctionBodies(source: string): Map<string, string> {
  const blanked = blankLiterals(source);
  const bodies = new Map<string, string>();
  for (const m of blanked.matchAll(
    /\bfunction\s+([A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\s*\(/g
  )) {
    const open = m.index! + m[0].length - 1;
    const params = argumentsAt(blanked, open);
    const brace = blanked.indexOf("{", open + params.length + 2);
    if (brace !== -1) bodies.set(m[1]!, argumentsAt(blanked, brace));
  }
  for (const m of blanked.matchAll(
    /\b(?:const|let)\s+([A-Za-z_$][\w$]*)\s*(?::[^=]+)?=(?!=)\s*/g
  )) {
    const start = m.index! + m[0].length;
    const hook = /^(?:React\.)?useCallback\(/.exec(blanked.slice(start));
    if (hook) {
      bodies.set(m[1]!, argumentsAt(blanked, start + hook[0].length - 1));
      continue;
    }
    const arrow = blanked.indexOf("=>", start);
    if (arrow === -1) continue;
    const head = blanked.slice(start, arrow);
    // Only an arrow bound directly: `(…) =>`, `async (…) =>` or `x =>`,
    // never a later statement's arrow.
    if (
      head.includes(";") ||
      !/^(?:async\s*)?(?:\(|[A-Za-z_$][\w$]*\s*$)/.test(head)
    ) {
      continue;
    }
    bodies.set(m[1]!, arrowBody(blanked, arrow + 2));
  }
  return bodies;
}

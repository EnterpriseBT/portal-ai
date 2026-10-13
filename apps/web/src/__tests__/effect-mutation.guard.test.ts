/**
 * #783: a mutation fired from an effect reads its promise (`mutateAsync`),
 * never `mutate` with per-call callbacks, `mutateAsync` with per-call
 * callbacks, or the hook's `isPending`/`data`/`error`.
 *
 * In development StrictMode runs an effect twice. The second call joins the
 * first call's in-flight promise (#751's single-flight), and by then React
 * Query's observer has dropped that mutation, so the hook's state never
 * updates and observer-level per-call callbacks never run. The promise always
 * settles. Production never double-runs effects, so this is dev-only, and it
 * is held here rather than patched in `useAuthMutation`.
 *
 * Inside the callback of any `useEffect`/`useLayoutEffect` (arrow, function,
 * async, block or expression body), the guard flags:
 * - `.mutate(…)`;
 * - a call through a name destructured from `mutate` (`const { mutate } =`,
 *   `const { mutate: touch } =`);
 * - `mutateAsync(…)` (or a name destructured from it) with a second, options
 *   argument.
 * It can't see an effect that calls `mutateAsync` and then renders from the
 * hook's `isPending`; CLAUDE.md ("API Calls & SDK Helpers") carries that half.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const webSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Offending calls allowed inside an effect, by file. Only shrinks. */
const ALLOWED: string[] = [];

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
function argumentsAt(source: string, open: number): string {
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
function topLevelArgs(args: string): string[] {
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

/** Each effect's callback (first argument), in a blanked source. */
export function effectCallbacks(blanked: string): string[] {
  return [...blanked.matchAll(/\buse(?:Layout)?Effect\(/g)].map(
    (m) =>
      topLevelArgs(argumentsAt(blanked, m.index! + m[0].length - 1))[0] ?? ""
  );
}

/** Names bound from `mutate` / `mutateAsync` by object destructuring. */
function destructuredNames(blanked: string, key: string): string[] {
  const names = new Set<string>();
  for (const m of blanked.matchAll(
    new RegExp(
      `[{,]\\s*${key}\\b(?:\\s*:\\s*([A-Za-z_$][\\w$]*))?\\s*(?=[,}=])`,
      "g"
    )
  )) {
    names.add(m[1] ?? key);
  }
  return [...names];
}

/** The offending calls inside effects in `source`, as trimmed snippets. */
export function effectMutationsIn(source: string): string[] {
  const blanked = blankLiterals(source);
  const mutateNames = destructuredNames(blanked, "mutate");
  const asyncNames = destructuredNames(blanked, "mutateAsync");
  const snippet = (s: string) => s.replace(/\s+/g, " ").trim().slice(0, 120);
  const found: string[] = [];
  for (const body of effectCallbacks(blanked)) {
    const bad =
      /\.mutate\(/.test(body) ||
      mutateNames.some((n) => new RegExp(`(?<![\\w$.])${n}\\(`).test(body)) ||
      [...body.matchAll(/(?:\.mutateAsync|(?<![\w$.])[A-Za-z_$][\w$]*)\(/g)]
        .filter((call) => {
          const name = call[0].replace(/^\./, "").slice(0, -1);
          return name === "mutateAsync" || asyncNames.includes(name);
        })
        .some(
          (call) =>
            topLevelArgs(argumentsAt(body, call.index! + call[0].length - 1))
              .length > 1
        );
    if (bad) found.push(snippet(body));
  }
  return found;
}

function sourceFiles(dir: string): string[] {
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

describe("effects read a mutation's promise (#783)", () => {
  const files = sourceFiles(webSrc).map((path) => ({
    path: relative(webSrc, path),
    source: readFileSync(path, "utf8"),
  }));

  it("parses the app's effects (so the guard can't pass vacuously)", () => {
    const parsed = files.reduce(
      (n, f) =>
        n + effectCallbacks(blankLiterals(f.source)).filter(Boolean).length,
      0
    );
    expect(parsed).toBeGreaterThanOrEqual(50);
  });

  it("no effect calls mutate, or mutateAsync with per-call callbacks", () => {
    const offenders = files
      .filter((f) => !ALLOWED.includes(f.path))
      .flatMap((f) =>
        effectMutationsIn(f.source).map((body) => `${f.path}: ${body}`)
      );
    expect(offenders).toEqual([]);
  });

  it("every allowlisted file still has an offending effect (the list only shrinks)", () => {
    for (const path of ALLOWED) {
      const file = files.find((f) => f.path === path);
      expect(file && effectMutationsIn(file.source).length).toBeGreaterThan(0);
    }
  });

  describe("self-test", () => {
    const flags = (src: string) => effectMutationsIn(src).length > 0;

    it("flags .mutate( in every effect shape", () => {
      expect(
        flags(`useEffect(() => { if (x) { m.mutate(1, {}); } }, []);`)
      ).toBe(true);
      expect(flags(`React.useEffect(() => void m.mutate(1), [id]);`)).toBe(
        true
      );
      expect(flags(`useLayoutEffect(() => { m.mutate(1); });`)).toBe(true);
      expect(flags(`useEffect(function () { m.mutate(1); }, []);`)).toBe(true);
      expect(flags(`useEffect(async () => { await m.mutate(1); }, []);`)).toBe(
        true
      );
    });

    it("flags a call through a name destructured from mutate", () => {
      expect(
        flags(`const { mutate: touch } = sdk.portals.touch(id);
useEffect(() => { touch(v, { onSuccess }); }, []);`)
      ).toBe(true);
      expect(
        flags(`const { mutate, isPending } = sdk.x.y();
useEffect(() => { mutate(v); }, []);`)
      ).toBe(true);
    });

    it("flags mutateAsync with per-call callbacks", () => {
      expect(
        flags(
          `useEffect(() => { void m.mutateAsync(v, { onSuccess: f }); }, []);`
        )
      ).toBe(true);
      expect(
        flags(`const { mutateAsync: accept } = sdk.i.accept();
useEffect(() => { void accept(v, { onError: f }); }, []);`)
      ).toBe(true);
    });

    it("passes a promise-reading effect and calls outside effects", () => {
      expect(
        flags(`useEffect(() => { void m.mutateAsync(1).then(done); }, []);`)
      ).toBe(false);
      expect(
        flags(`const { mutateAsync: accept } = sdk.i.accept();
useEffect(() => { void accept({ token }).then(done); }, []);`)
      ).toBe(false);
      expect(
        flags(`useEffect(() => { setOpen(true); }, []);
const onClick = () => m.mutate(1);`)
      ).toBe(false);
    });

    it("isn't fooled by braces or calls inside strings and comments", () => {
      expect(flags(`useEffect(() => { log("}"); m.mutate(v); }, []);`)).toBe(
        true
      );
      expect(
        flags(`useEffect(() => { log("m.mutate(x)"); /* m.mutate(y) */ }, []);`)
      ).toBe(false);
    });
  });
});

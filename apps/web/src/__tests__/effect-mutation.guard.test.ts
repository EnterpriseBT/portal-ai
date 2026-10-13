/**
 * #783: a mutation fired from an effect reads its promise (`mutateAsync`),
 * never `.mutate(…)` with per-call callbacks or the hook's `isPending`.
 *
 * In development StrictMode runs a mount effect twice. The second call joins
 * the first call's in-flight promise (#751's single-flight), and by then
 * React Query's observer has dropped that mutation, so the hook's
 * `isPending`/`data`/`error` never update and observer-level per-call
 * callbacks never run. The promise always settles. Production never
 * double-runs effects, so this is dev-only, and it is held here rather than
 * patched in `useAuthMutation`.
 *
 * The guard catches `.mutate(` inside a `useEffect` body. It can't see an
 * effect that calls `mutateAsync` and then renders from the hook's
 * `isPending`; CLAUDE.md ("API Calls & SDK Helpers") carries that half.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const webSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `.mutate(` calls allowed inside an effect, by file. Only shrinks. */
const ALLOWED: string[] = [];

/** The balanced `{…}` block starting at `open`. */
function blockAt(source: string, open: number): string {
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      return source.slice(open + 1, i);
    }
  }
  return source.slice(open + 1);
}

/** Every `useEffect` body that calls `.mutate(`, as a trimmed snippet. */
export function effectMutatesIn(source: string): string[] {
  const found: string[] = [];
  for (const m of source.matchAll(/\buseEffect\(\s*\(\)\s*=>\s*\{/g)) {
    const body = blockAt(source, m.index! + m[0].length - 1);
    if (/\.mutate\(/.test(body)) {
      found.push(body.replace(/\s+/g, " ").trim().slice(0, 120));
    }
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

describe("effects read a mutation's promise, not .mutate callbacks (#783)", () => {
  const files = sourceFiles(webSrc).map((path) => ({
    path: relative(webSrc, path),
    source: readFileSync(path, "utf8"),
  }));

  it("finds the app's effects (so the guard can't pass vacuously)", () => {
    const effects = files.reduce(
      (n, f) => n + (f.source.match(/\buseEffect\(/g)?.length ?? 0),
      0
    );
    expect(effects).toBeGreaterThanOrEqual(50);
  });

  it("no effect calls .mutate(", () => {
    const offenders = files
      .filter((f) => !ALLOWED.includes(f.path))
      .flatMap((f) =>
        effectMutatesIn(f.source).map((body) => `${f.path}: ${body}`)
      );
    expect(offenders).toEqual([]);
  });

  it("flags .mutate( in an effect, and passes mutateAsync or a handler", () => {
    expect(
      effectMutatesIn(
        `React.useEffect(() => { if (x) { m.mutate(1, {}); } }, []);`
      )
    ).toHaveLength(1);
    expect(
      effectMutatesIn(
        `useEffect(() => { void m.mutateAsync(1).then(done); }, []);`
      )
    ).toEqual([]);
    expect(
      effectMutatesIn(
        `useEffect(() => { setOpen(true); }, []);\nconst onClick = () => m.mutate(1);`
      )
    ).toEqual([]);
  });
});

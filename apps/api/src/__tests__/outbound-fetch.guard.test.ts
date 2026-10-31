import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * #931: every fetch to an org-supplied URL goes through `guardedFetch`,
 * which checks each connection's address and applies the caller's redirect
 * policy. A bare `fetch(` in these modules would skip both, as the toolpack
 * fetchers and the REST connector did before #931. `fetchImpl(` (an
 * injected fetch whose default is guarded) is allowed.
 */
const GUARDED = [
  "src/services/toolpack-registration.service.ts",
  "src/services/tools.service.ts",
  "src/adapters/rest-api",
];

/** Files allowed a bare fetch, each with a reason. Only shrinks. */
const EXEMPT: Record<string, string> = {};

function sourceFiles(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path).flatMap((name) =>
    /\.ts$/.test(name) || statSync(join(path, name)).isDirectory()
      ? sourceFiles(join(path, name))
      : []
  );
}

function stripComments(source: string): string {
  return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

/** The unguarded fetches in `source`: a bare call, or the global as a value. */
function unguardedFetches(source: string): string[] {
  const code = stripComments(source);
  const hits: string[] = [];
  for (const m of code.matchAll(/(^|[^\w.$])fetch\s*\(/g))
    hits.push(m[0].trim());
  for (const m of code.matchAll(/globalThis\.fetch\s*\(/g)) hits.push(m[0]);
  for (const m of code.matchAll(
    /(=|\?\?|\(|,)\s*globalThis\.fetch\b(?!\s*\()/g
  )) {
    hits.push(m[0].trim());
  }
  return hits;
}

describe("outbound fetches go through guardedFetch (#931)", () => {
  it("no guarded module fetches directly", () => {
    const files = GUARDED.flatMap(sourceFiles);
    // Not vacuous: the REST adapter alone is many files.
    expect(files.length).toBeGreaterThan(10);
    const hits = files
      .filter((f) => !(f in EXEMPT))
      .flatMap((f) =>
        unguardedFetches(readFileSync(f, "utf8")).map((h) => `${f}: ${h}`)
      );
    expect(hits).toEqual([]);
  });

  it("catches a bare call and the global used as a default", () => {
    expect(unguardedFetches("const r = await fetch(url, init);")).toHaveLength(
      1
    );
    expect(unguardedFetches("await globalThis.fetch(url)")).toHaveLength(1);
    expect(
      unguardedFetches("function f(impl = globalThis.fetch) {}")
    ).toHaveLength(1);
    expect(
      unguardedFetches("const impl = opts.f ?? globalThis.fetch;")
    ).toHaveLength(1);
  });

  it("allows an injected fetch, the type, guardedFetch and comments", () => {
    expect(
      unguardedFetches(
        [
          "await fetchImpl(url, init);",
          "let f: typeof globalThis.fetch = restFetch;",
          "await guardedFetch(url, init, opts);",
          "// fetch(url) in a comment",
          "/* globalThis.fetch(url) */",
        ].join("\n")
      )
    ).toEqual([]);
  });
});

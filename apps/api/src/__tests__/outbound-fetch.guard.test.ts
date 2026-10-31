import { describe, it, expect } from "@jest/globals";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

/**
 * #931: every fetch to an org-supplied URL goes through `guardedFetch`,
 * which checks each connection's address and applies the caller's redirect
 * policy. A bare `fetch(` would skip both, as the toolpack fetchers and the
 * REST connector did before #931. The whole of `src` is scanned, so a new
 * outbound path fails here until it's guarded or exempted with a reason.
 * `fetchImpl(` (an injected fetch whose default is guarded) is allowed.
 */
const ROOT = "src";

/** Files allowed a bare fetch, each with a reason. Only shrinks. */
const EXEMPT: Record<string, string> = {
  "src/utils/guarded-fetch.util.ts": "the guarded primitive itself",
  "src/services/auth0.service.ts":
    "the Auth0 tenant from AUTH0_* env, not an org-supplied URL",
  "src/services/rebuild-dispatch.service.ts":
    "a fixed api.github.com repository_dispatch URL",
  "src/routes/webhook.router.ts":
    "an AWS SNS SubscribeURL, fetched only after the message's signature check",
  "src/scripts/mock-toolpack-server.ts":
    "the dev-only mock toolpack, calling back to the local API",
};

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.ts$/.test(name) ? [path] : [];
  });
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
  it("nothing in src fetches directly outside the exemptions", () => {
    const files = sourceFiles(ROOT);
    // Not vacuous: all of src is scanned.
    expect(files.length).toBeGreaterThan(300);
    const hits = files
      .filter((f) => !(f in EXEMPT))
      .flatMap((f) =>
        unguardedFetches(readFileSync(f, "utf8")).map((h) => `${f}: ${h}`)
      );
    expect(hits).toEqual([]);
  });

  it("every exemption is a file that still fetches directly", () => {
    for (const file of Object.keys(EXEMPT)) {
      expect(
        unguardedFetches(readFileSync(file, "utf8")).length
      ).toBeGreaterThan(0);
    }
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

/**
 * `@portalai/core/content` purity guard (#311).
 *
 * The marketing site consumes this module from a static-site generator at
 * build time. Anything it imports — a router, a bundler alias, a browser
 * global, even another core subpath — becomes a build-time dependency of a
 * page that must render with no JavaScript at all. So a content module
 * imports nothing but its sibling content modules (#1049).
 *
 * This is a source-level check on purpose: a runtime import test would pass
 * for a dependency that merely happens to resolve in Jest.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const CONTENT_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "../../content"
);

const sourceFiles = fs
  .readdirSync(CONTENT_DIR)
  .filter((f) => f.endsWith(".ts") && f !== "index.ts");

describe("content module purity", () => {
  it("ships the expected data modules", () => {
    expect(sourceFiles.sort()).toEqual([
      "faq.util.ts",
      "glossary.util.ts",
      // #1049 — the help ranker. Imports its sibling content modules only.
      "help-search.util.ts",
      // #367 — the writer for the #365 Help URL grammar. Pure string
      // building, no imports, so it belongs to the same guarantee.
      "help-url.util.ts",
      // #674 — the shared empty-station sentences (web alerts, system prompt,
      // platform_help). Pure string logic, no imports.
      "station-attachments.util.ts",
      // #613 — the public subprocessor list, rendered by the marketing site's
      // /security/ and privacy pages and checked against the API's egress.
      "subprocessors.util.ts",
      // #1049 — troubleshooting entries, in-app only.
      "troubleshooting.util.ts",
    ]);
  });

  // #1049: a content module may import a sibling content module (the help
  // ranker builds one corpus from the FAQ, glossary and troubleshooting), and
  // nothing else: no package, no other core subpath, no `../`. The guarantee
  // the site relies on, no runtime dependency, still holds.
  it.each(sourceFiles)("%s imports nothing outside content/", (file) => {
    const src = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
    const imports =
      src.match(/^\s*import\s[\s\S]*?from\s+["'][^"']+["'];?$/gm) ?? [];
    const outside = imports.filter(
      (line) => !/from\s+["']\.\/[a-z-]+\.util\.js["']/.test(line)
    );
    expect(outside).toEqual([]);
    // A bare `import "x"` (side effect) is never allowed.
    expect(src.match(/^\s*import\s+["'][^"']+["'];?$/gm) ?? []).toEqual([]);
  });

  it("the barrel re-exports only sibling content modules", () => {
    const src = fs.readFileSync(path.join(CONTENT_DIR, "index.ts"), "utf8");
    const specifiers = [...src.matchAll(/from\s+"([^"]+)"/g)].map((m) => m[1]);
    expect(specifiers.length).toBeGreaterThan(0);
    for (const spec of specifiers) {
      expect(spec.startsWith("./")).toBe(true);
    }
  });
});

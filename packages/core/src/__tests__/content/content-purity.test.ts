/**
 * `@portalai/core/content` purity guard (#311).
 *
 * The marketing site consumes this module from a static-site generator at
 * build time. Anything it imports — a router, a bundler alias, a browser
 * global, even another core subpath — becomes a build-time dependency of a
 * page that must render with no JavaScript at all. The cheapest way to keep
 * that true is to allow no imports whatsoever.
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
    expect(sourceFiles.sort()).toEqual(["faq.util.ts", "glossary.util.ts"]);
  });

  it.each(sourceFiles)("%s imports nothing", (file) => {
    const src = fs.readFileSync(path.join(CONTENT_DIR, file), "utf8");
    const imports = src.match(/^\s*import\s.+$/gm) ?? [];
    expect(imports).toEqual([]);
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

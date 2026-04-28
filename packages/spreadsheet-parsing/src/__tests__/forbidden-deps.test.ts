import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

const here = path.dirname(fileURLToPath(import.meta.url));
const packageRoot = path.resolve(here, "..", "..");
const srcRoot = path.resolve(packageRoot, "src");

/**
 * External dependencies the parser module is forbidden from importing.
 * Network I/O, LLM calls, and server-side logging live in `apps/api/` and
 * inject themselves through the parser's `ClassifierFn` /
 * `AxisNameRecommenderFn` DI slots.
 */
const FORBIDDEN_EXTERNAL_IMPORTS = [
  "ai",
  "@ai-sdk/anthropic",
  "@ai-sdk/openai",
  "@ai-sdk/groq",
  "@ai-sdk/provider",
  "@ai-sdk/provider-utils",
  "pino",
  "axios",
  "node-fetch",
  "undici",
];

/**
 * Node builtins. Allowed under `src/replay/` (exported via the Node-only
 * `/replay` subpath), forbidden everywhere else so the main entry stays
 * browser-safe (Storybook, web bundles don't pull `node:crypto` etc.).
 */
const FORBIDDEN_NODE_BUILTINS = [
  "node:crypto",
  "node:fs",
  "node:path",
  "node:stream",
  "node:buffer",
  "node:url",
  "node:os",
  "node:child_process",
];

const REPLAY_DIR = path.join(srcRoot, "replay");
const UI_DIR = path.join(srcRoot, "ui");

function isUnder(file: string, dir: string): boolean {
  return file === dir || file.startsWith(dir + path.sep);
}

/** Allowed runtime dependencies. Anything else in package.json is a violation. */
const ALLOWED_RUNTIME_DEPS = new Set(["zod"]);

interface PackageJson {
  dependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
}

function walkTsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "node_modules" || entry.name === "dist") continue;
      // Tests are allowed to reference forbidden patterns when asserting
      // about them; the audit scans production source only.
      if (entry.name === "__tests__") continue;
      out.push(...walkTsFiles(full));
    } else if (entry.isFile() && /\.ts$/.test(entry.name)) {
      out.push(full);
    }
  }
  return out;
}

describe("@portalai/spreadsheet-parsing — forbidden-deps audit", () => {
  const pkgJson = JSON.parse(
    fs.readFileSync(path.join(packageRoot, "package.json"), "utf8")
  ) as PackageJson;

  it("declares only allowed runtime dependencies in package.json", () => {
    const deps = Object.keys(pkgJson.dependencies ?? {});
    const forbidden = deps.filter((d) => !ALLOWED_RUNTIME_DEPS.has(d));
    expect(forbidden).toEqual([]);
  });

  it("declares no peerDependencies that would leak an SDK onto consumers", () => {
    const peers = Object.keys(pkgJson.peerDependencies ?? {});
    expect(peers).toEqual([]);
  });

  const sourceFiles = walkTsFiles(srcRoot);
  const browserSafeSourceFiles = sourceFiles.filter(
    (f) => !isUnder(f, REPLAY_DIR)
  );
  const mainEntryFiles = sourceFiles.filter(
    (f) => !isUnder(f, REPLAY_DIR) && !isUnder(f, UI_DIR)
  );
  const uiSourceFiles = sourceFiles.filter((f) => isUnder(f, UI_DIR));

  function fileMentionsPath(file: string, needle: RegExp): boolean {
    return needle.test(fs.readFileSync(file, "utf8"));
  }

  it.each(FORBIDDEN_EXTERNAL_IMPORTS)(
    "no source file imports from %s",
    (forbiddenModule) => {
      const offenders: string[] = [];
      const importRegex = new RegExp(
        `(?:from\\s+['"]|import\\s*\\(\\s*['"])${forbiddenModule.replace(
          /[/\\.]/g,
          "\\$&"
        )}(?:['"]|/)`
      );
      for (const file of sourceFiles) {
        const contents = fs.readFileSync(file, "utf8");
        if (importRegex.test(contents)) {
          offenders.push(path.relative(packageRoot, file));
        }
      }
      expect(offenders).toEqual([]);
    }
  );

  // Node builtins are allowed under `src/replay/` (exposed via the /replay
  // subpath, Node-only). The main entry and every other subtree must stay
  // browser-safe.
  it.each(FORBIDDEN_NODE_BUILTINS)(
    "no browser-safe source file imports from %s (only src/replay/ may)",
    (nodeModule) => {
      const offenders: string[] = [];
      const importRegex = new RegExp(
        `(?:from\\s+['"]|import\\s*\\(\\s*['"])${nodeModule.replace(
          /[/\\.]/g,
          "\\$&"
        )}(?:['"]|/)`
      );
      for (const file of browserSafeSourceFiles) {
        const contents = fs.readFileSync(file, "utf8");
        if (importRegex.test(contents)) {
          offenders.push(path.relative(packageRoot, file));
        }
      }
      expect(offenders).toEqual([]);
    }
  );

  it("no source file reads process.env directly (server-side concern)", () => {
    const offenders: string[] = [];
    for (const file of sourceFiles) {
      const contents = fs.readFileSync(file, "utf8");
      if (/process\.env\b/.test(contents)) {
        offenders.push(path.relative(packageRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  // ── Cross-subpath isolation ────────────────────────────────────────────
  // Main entry (cross-compatible) must not import from the Node-only /replay
  // subtree nor from the browser-only /ui subtree. Preserves the main
  // bundle's ability to run in either environment.
  it("main-entry source files do not import from the /replay subtree", () => {
    const offenders: string[] = [];
    for (const file of mainEntryFiles) {
      if (fileMentionsPath(file, /from\s+["'][^"']*\/replay\//)) {
        offenders.push(path.relative(packageRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  it("main-entry source files do not import from the /ui subtree", () => {
    const offenders: string[] = [];
    for (const file of mainEntryFiles) {
      if (fileMentionsPath(file, /from\s+["'][^"']*\/ui\//)) {
        offenders.push(path.relative(packageRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });

  // /ui (browser-only) must not reach back into /replay (Node-only) — doing
  // so would transitively pull node:crypto into the browser bundle.
  it("/ui source files do not import from the /replay subtree", () => {
    const offenders: string[] = [];
    for (const file of uiSourceFiles) {
      if (fileMentionsPath(file, /from\s+["'][^"']*\/replay\//)) {
        offenders.push(path.relative(packageRoot, file));
      }
    }
    expect(offenders).toEqual([]);
  });
});

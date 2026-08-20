#!/usr/bin/env node
/**
 * Fails when a source comment cites a `docs/*.md` file that doesn't exist.
 *
 * These pointers read as authoritative design references, so a dangling one
 * sends the next contributor — human or agent — chasing rationale that isn't
 * there (#417). The failure is cheapest at the commit that *deletes* the doc,
 * which is what this gate makes possible.
 *
 * Scope is source only (`apps/*` + `packages/*`, ts/tsx). Doc-to-doc pointers
 * are #419.
 *
 * Usage: npm run lint:doc-pointers
 */

import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Matches `docs/…​.md`, including brace forms like `phase-{B,C}`. */
const POINTER = /docs\/[A-Za-z0-9_.,{}-]+\.md/g;

/**
 * Expand a single brace group — `phase-{B,C}.plan.md` becomes two candidates.
 * A citation written that way is satisfied only if every expansion resolves,
 * since it claims both docs exist.
 */
const expandBraces = (pointer) => {
  const group = /\{([^{}]*)\}/.exec(pointer);
  if (!group) return [pointer];
  const before = pointer.slice(0, group.index);
  const after = pointer.slice(group.index + group[0].length);
  return group[1]
    .split(",")
    .flatMap((option) => expandBraces(before + option + after));
};

// Filtering happens here rather than in the pathspec on purpose: a
// `src/**/*.ts` glob silently skips files sitting directly in `src/` (e.g.
// apps/api/src/environment.ts, 3 of the original 46 sites), and `apps/*/src`
// matches nothing at all since git globs the full path, not a directory prefix.
const isSourceFile = (file) =>
  /^(apps|packages)\/[^/]+\/src\//.test(file) &&
  (file.endsWith(".ts") || file.endsWith(".tsx"));

const sourceFiles = execFileSync("git", ["ls-files", "--", "apps", "packages"], {
  cwd: repoRoot,
  encoding: "utf8",
  maxBuffer: 64 * 1024 * 1024,
})
  .split("\n")
  .filter(isSourceFile);

const dead = [];

for (const file of sourceFiles) {
  const contents = readFileSync(join(repoRoot, file), "utf8");
  contents.split("\n").forEach((line, index) => {
    for (const pointer of line.match(POINTER) ?? []) {
      const missing = expandBraces(pointer).filter(
        (candidate) => !existsSync(join(repoRoot, candidate))
      );
      if (missing.length > 0) {
        dead.push({ file, line: index + 1, pointer, missing });
      }
    }
  });
}

if (dead.length === 0) {
  console.log(
    `check-doc-pointers: every docs/*.md pointer across ${sourceFiles.length} source files resolves.`
  );
  process.exit(0);
}

console.error(
  `check-doc-pointers: ${dead.length} source comment(s) cite a docs/*.md file that does not exist.\n`
);
for (const { file, line, pointer, missing } of dead) {
  const detail =
    missing.length === 1 && missing[0] === pointer
      ? ""
      : ` → missing ${missing.join(", ")}`;
  console.error(`  ${file}:${line}  ${pointer}${detail}`);
}
console.error(
  "\nFix each site: repoint it at the surviving doc, inline the rationale it was standing in for,\n" +
    "or drop the pointer when the surrounding prose already stands on its own.\n" +
    "See docs/DEAD_DOC_POINTERS.md."
);
process.exit(1);

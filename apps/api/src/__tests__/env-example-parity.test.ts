/**
 * Developer-surface parity guard (#382).
 *
 * `.env.example` is the authoritative inventory of what the API reads. It had
 * drifted badly: 23 variables were read with no line here — including
 * ANTHROPIC_API_KEY and TAVILY_API_KEY, without which the agent and web
 * search simply don't work — while two documented names (UPLOAD_MAX_FILES,
 * UPLOAD_MAX_FILE_SIZE_MB) had been renamed in code, so setting the
 * documented variable did nothing at all and said nothing about it.
 *
 * Two assertions, in both directions but neither of them equality:
 *
 *   1. Every `process.env.X` read under src/ is declared in `.env.example`
 *      (set or commented), or is on ALLOWED_UNDOCUMENTED with a reason.
 *   2. Every name `.env.example` declares is either read by our code or on
 *      READ_BY_OTHERS — so a rename can't leave a dead line behind.
 *
 * The allow-lists are what keep this honest: an undocumented variable becomes
 * a reviewed decision rather than an accident.
 */

import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import { describe, it, expect } from "@jest/globals";

// Resolved from this file, not from cwd — jest may run from the package
// directory or the monorepo root depending on the invoking script.
const here = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(here, "../..");

/**
 * Read but deliberately absent from `.env.example`. Each entry needs a
 * reason — "it was already like that" is not one.
 */
const ALLOWED_UNDOCUMENTED: Record<string, string> = {
  NODE_ENV: "set by the runtime and by backend.yml; never a developer's to set",
};

/**
 * Declared in `.env.example` but read by something other than our code.
 * Removing these would break real setups.
 */
const READ_BY_OTHERS: Record<string, string> = {
  AWS_ACCESS_KEY_ID: "read by the AWS SDK credential chain, not by us",
  AWS_SECRET_ACCESS_KEY: "read by the AWS SDK credential chain, not by us",
  NGROK_AUTHTOKEN: "read by the ngrok binary that `npm run dev` starts",
};

/** Every `process.env.X` read under src/, excluding test trees. */
function readsInSource(): Map<string, string> {
  const found = new Map<string, string>();
  const walk = (dir: string): void => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        if (entry.name === "__tests__" || entry.name === "__integration__")
          continue;
        walk(full);
        continue;
      }
      if (!entry.name.endsWith(".ts")) continue;
      const body = fs.readFileSync(full, "utf8");
      for (const m of body.matchAll(/process\.env\.([A-Z][A-Z0-9_]*)/g)) {
        const rel = path.relative(ROOT, full);
        if (!found.has(m[1])) found.set(m[1], rel);
      }
    }
  };
  walk(path.join(ROOT, "src"));
  return found;
}

/** Every name `.env.example` declares, set (`X=`) or commented (`# X=`). */
function declaredInExample(): Set<string> {
  const body = fs.readFileSync(path.join(ROOT, ".env.example"), "utf8");
  const names = new Set<string>();
  for (const line of body.split("\n")) {
    const m = /^#?\s*([A-Z][A-Z0-9_]*)=/.exec(line.trim());
    if (m) names.add(m[1]);
  }
  return names;
}

describe(".env.example is the authoritative inventory (#382)", () => {
  const reads = readsInSource();
  const declared = declaredInExample();

  it("finds a plausible number of reads", () => {
    // Guards the guard: a broken walk that finds nothing would pass silently.
    expect(reads.size).toBeGreaterThan(40);
    expect(declared.size).toBeGreaterThan(40);
  });

  it("documents every variable the code reads", () => {
    const undocumented = [...reads.entries()]
      .filter(([key]) => !declared.has(key) && !(key in ALLOWED_UNDOCUMENTED))
      .map(([key, where]) => `${key} (read at ${where})`);

    expect(undocumented).toEqual([]);
  });

  it("declares nothing the code no longer reads", () => {
    // The UPLOAD_MAX_FILE_SIZE_MB / UPLOAD_MAX_FILES case: a renamed variable
    // left its old name documented, so setting it did nothing, silently.
    const dead = [...declared].filter(
      (key) => !reads.has(key) && !(key in READ_BY_OTHERS)
    );

    expect(dead).toEqual([]);
  });

  it("keeps every allow-list entry earning its place", () => {
    for (const key of Object.keys(ALLOWED_UNDOCUMENTED)) {
      expect(reads.has(key)).toBe(true);
      expect(declared.has(key)).toBe(false);
    }
    for (const key of Object.keys(READ_BY_OTHERS)) {
      expect(declared.has(key)).toBe(true);
      expect(reads.has(key)).toBe(false);
    }
  });
});

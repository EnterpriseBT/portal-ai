/**
 * #731: a by-id permission check names the object's creator. An ownership
 * condition (`created_by_caller` / `created_by_system`) only matches a known
 * creator, so a check that left `createdBy` out failed closed for members
 * while owners and admins passed through `* *`, and nobody noticed (#729).
 *
 * `PermissionObject` makes that a type error: an object with an `id` must
 * carry `createdBy: string | null` (`null` = creator unknown, said out loud).
 * A cast is the one way past the compiler, so this guard fails CI on any
 * `as PermissionObject` in the API source. There is no allowlist.
 *
 * Read as UTF-8 text, never via `grep`: `permission-set.ts` carries NUL-byte
 * sentinels, so grep treats it as binary and skips it.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

const CAST = /\bas\s+(unknown\s+as\s+)?PermissionObject\b/;

/** Every line of `source` that casts to `PermissionObject`. */
export function permissionObjectCasts(source: string): string[] {
  return source
    .split("\n")
    .filter((line) => CAST.test(line))
    .map((line) => line.trim());
}

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return path.endsWith(".ts") ? [path] : [];
  });
}

describe("by-id permission objects aren't cast past the type (#731)", () => {
  const files = sourceFiles(apiSrc).map((path) => ({
    path: relative(apiSrc, path),
    source: readFileSync(path, "utf8"),
  }));

  it("scans the API source, including the NUL-byte permission-set.ts", () => {
    expect(files.length).toBeGreaterThanOrEqual(200);
    const set = files.find((f) => f.path === "services/permission-set.ts");
    expect(set?.source).toContain("permissionDenied(action, object)");
  });

  it("no source file casts to PermissionObject", () => {
    const offenders = files.flatMap((f) =>
      permissionObjectCasts(f.source).map((line) => `${f.path}: ${line}`)
    );
    expect(offenders).toEqual([]);
  });

  it("catches each cast form, and lets ordinary uses through", () => {
    for (const bad of [
      "set.can(action, { type, id } as PermissionObject);",
      "const o = x as unknown as PermissionObject;",
      "}) as PermissionObject,",
    ]) {
      expect([bad, permissionObjectCasts(bad)]).toEqual([bad, [bad]]);
    }
    for (const ok of [
      "object?: PermissionObject",
      "import type { PermissionObject } from './permission.service.js';",
      "const o: PermissionObject = { type, id, createdBy: null };",
    ]) {
      expect([ok, permissionObjectCasts(ok)]).toEqual([ok, []]);
    }
  });
});

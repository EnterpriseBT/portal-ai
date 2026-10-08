/**
 * #731: a by-id permission check names the object's creator. An ownership
 * condition (`created_by_caller` / `created_by_system`) only matches a known
 * creator, so a check that left `createdBy` out failed closed for members
 * while owners and admins passed through `* *`, and nobody noticed (#729).
 *
 * `PermissionObject` makes that a type error: an object with an `id` must
 * carry `createdBy: string | null`. This guard closes the two ways past it:
 *
 * - **A cast.** Any `as PermissionObject` / `<PermissionObject>`, and any cast
 *   (`as never`, `as any`, …) on an argument of a permission call, except the
 *   action string's `as PermissionAction`. There is no allowlist.
 * - **A silent `?? null`.** `null` means "creator unknown", which is right for
 *   a deleted row or an id that isn't the parent's, and is the #729 bug when
 *   the creator simply wasn't looked up. The compiler can't tell them apart, so
 *   a `createdBy: … ?? null` must carry its reason, a comment citing an issue
 *   (`// #729: …`) on the same line or directly above.
 *
 * Parsed with the TypeScript AST rather than grepped: casts span lines, and
 * `permission-set.ts` carries NUL-byte sentinels that make grep skip it.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Calls whose arguments carry a permission object. */
const PERMISSION_CALLS = new Set([
  "can",
  "check",
  "isDenied",
  "assertWithinBoundary",
]);
const REASON = /\/\/.*#\d+|\/\*[\s\S]*#\d+[\s\S]*\*\//;

function isCast(n: ts.Node): n is ts.AsExpression | ts.TypeAssertion {
  return ts.isAsExpression(n) || ts.isTypeAssertionExpression(n);
}

/** Every violation in `source`, as `<line>: <text>`. */
export function permissionObjectViolations(source: string): string[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const lines = source.split("\n");
  const out: string[] = [];
  const report = (n: ts.Node, why: string) => {
    const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
    out.push(`${line + 1}: ${why}: ${lines[line].trim()}`);
  };

  const visit = (n: ts.Node): void => {
    if (isCast(n) && /\bPermissionObject\b/.test(n.type.getText(sf))) {
      report(n, "cast to PermissionObject");
    } else if (
      ts.isCallExpression(n) &&
      ts.isPropertyAccessExpression(n.expression) &&
      PERMISSION_CALLS.has(n.expression.name.text)
    ) {
      for (const arg of n.arguments) {
        // A PermissionObject cast is reported once, by the branch above.
        if (
          isCast(arg) &&
          arg.type.getText(sf) !== "PermissionAction" &&
          !/\bPermissionObject\b/.test(arg.type.getText(sf))
        ) {
          report(arg, "cast on a permission-call argument");
        }
      }
    } else if (
      ts.isPropertyAssignment(n) &&
      n.name.getText(sf) === "createdBy" &&
      ts.isBinaryExpression(n.initializer) &&
      n.initializer.operatorToken.kind ===
        ts.SyntaxKind.QuestionQuestionToken &&
      n.initializer.right.kind === ts.SyntaxKind.NullKeyword
    ) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
      if (!REASON.test(lines[line]) && !REASON.test(lines[line - 1] ?? "")) {
        report(n, "`createdBy: … ?? null` without a reason");
      }
    }
    ts.forEachChild(n, visit);
  };
  visit(sf);
  return out;
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

describe("by-id permission objects name their creator (#731)", () => {
  const files = sourceFiles(apiSrc).map((path) => ({
    path: relative(apiSrc, path),
    source: readFileSync(path, "utf8"),
  }));

  it("scans the permission engine and its callers", () => {
    const scanned = new Set(files.map((f) => f.path));
    for (const path of [
      "services/permission-set.ts",
      "services/permission.service.ts",
      "services/permission-gate.service.ts",
      "services/object-access.service.ts",
      "routes/curated-view.router.ts",
    ]) {
      expect([path, scanned.has(path)]).toEqual([path, true]);
    }
  });

  it("no source file casts past PermissionObject or nulls a creator silently", () => {
    const offenders = files.flatMap((f) =>
      permissionObjectViolations(f.source).map((v) => `${f.path}:${v}`)
    );
    expect(offenders).toEqual([]);
  });

  it("catches each bypass, and lets ordinary code through", () => {
    for (const bad of [
      "set.can(action, { type, id } as PermissionObject);",
      "const o = x as unknown as PermissionObject;",
      "const o = <PermissionObject>{ type, id };",
      "set.can(action, { type, id } as never);",
      "set.check(action, {\n  type,\n  id,\n} as any);",
      "set.isDenied('read', 'station', o as never);",
      "set.can(action, { type, id, createdBy: m.get(id) ?? null });",
    ]) {
      expect([bad, permissionObjectViolations(bad).length]).toEqual([bad, 1]);
    }
    for (const ok of [
      "function f(object?: PermissionObject) {}",
      "const o: PermissionObject = { type, id, createdBy: null };",
      "set.check(`resource.${verb}` as PermissionAction, object);",
      "set.can(action, { type, id, createdBy: row.createdBy });",
      "set.can(action, { type, id, createdBy: m.get(id) ?? null }); // #729: gone",
      "// #729: an id not on this entity has no creator\nconst o = { createdBy: m.get(id) ?? null };",
      "save(data as never);",
    ]) {
      expect([ok, permissionObjectViolations(ok)]).toEqual([ok, []]);
    }
  });
});

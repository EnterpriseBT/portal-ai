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
 * - **A forced or defaulted creator.** `null` means "creator unknown", which is
 *   right for a deleted row or an id that isn't the parent's, and is the #729
 *   bug when the creator simply wasn't looked up. The compiler can't tell them
 *   apart, nor see through `m.get(id)!`, `m.get(id) as string`, `?? ""` or
 *   `|| null`. So a `createdBy:` written with `!`, a cast, `??` or `||` must
 *   carry its reason, a comment citing an issue (`// #729: …`) on the same
 *   line or in the `//` block directly above.
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
/** A file that talks to the permission engine. The forced-creator rule only
 *  applies here: elsewhere a by-id `createdBy` is a row's audit stamp on a
 *  write (`prior?.createdBy ?? userId`), not an ownership claim. This is a
 *  heuristic boundary, so a new permission wrapper belongs in this list. */
const PERMISSION_DOMAIN =
  /\b(PermissionSet|PermissionService|ObjectAccessService|ObjectCapabilitiesService|PortalAccessService|ConnectorInstanceAccessService|CuratedViewPayloadService)\b|\.(can|check)\(/;
const REASON = /\/\/.*#\d+|\/\*[\s\S]*#\d+[\s\S]*\*\//;

function isCast(n: ts.Node): n is ts.AsExpression | ts.TypeAssertion {
  return ts.isAsExpression(n) || ts.isTypeAssertionExpression(n);
}

/**
 * A `createdBy` value that silences the compiler rather than naming a real
 * creator: a non-null `!`, a cast, or a `??` / `||` fallback (`?? null`,
 * `?? ""`, `|| null`, …). Each one turns "creator not looked up" into a value
 * the type accepts, which is the #729 bug (adversarial walk on #735).
 */
function forcesCreator(e: ts.Expression): boolean {
  while (ts.isParenthesizedExpression(e)) e = e.expression;
  return (
    ts.isNonNullExpression(e) ||
    isCast(e) ||
    (ts.isBinaryExpression(e) &&
      (e.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken ||
        e.operatorToken.kind === ts.SyntaxKind.BarBarToken))
  );
}

/** An object literal with an `id`: the by-id shape whose creator a
 *  permission check matches. A record write carries `createdBy` too, but its
 *  default (`prior?.createdBy ?? userId`) is the row's audit stamp, not an
 *  ownership claim. */
function isByIdObject(o: ts.Node): boolean {
  return (
    ts.isObjectLiteralExpression(o) &&
    o.properties.some(
      (p) =>
        p.name?.getText() === "id" ||
        (ts.isShorthandPropertyAssignment(p) && p.name.text === "id")
    )
  );
}

/** The line itself, or the `//` comment block directly above it, cites an
 *  issue. */
function hasReason(lines: string[], line: number): boolean {
  if (REASON.test(lines[line])) return true;
  for (let i = line - 1; i >= 0 && /^\s*(\/\/|:\s*\/\/)/.test(lines[i]); i--) {
    if (REASON.test(lines[i])) return true;
  }
  return false;
}

/** Every violation in `source`, as `<line>: <text>`. */
export function permissionObjectViolations(source: string): string[] {
  const inPermissionDomain = PERMISSION_DOMAIN.test(source);
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
      inPermissionDomain &&
      isByIdObject(n.parent) &&
      forcesCreator(n.initializer)
    ) {
      const line = sf.getLineAndCharacterOfPosition(n.getStart(sf)).line;
      if (!hasReason(lines, line)) {
        report(n, "`createdBy` forced or defaulted without a reason");
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

  it("no source file casts past PermissionObject or forces a creator silently", () => {
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
      "set.can(action, { type, id, createdBy: m.get(id)! });",
      "set.can(action, { type, id, createdBy: m.get(id) as string });",
      'set.can(action, { type, id, createdBy: m.get(id) ?? "" });',
      "set.can(action, { type, id, createdBy: (m.get(id) || null) });",
      "// #731: unrelated, a blank line breaks the block\n\nset.can(a, { id, createdBy: m.get(id)! });",
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
      "set.can(a, cond\n  ? x\n  : // #731: the map holds every id,\n    // as shown above.\n    { id, createdBy: m.get(id)! });",
      "set.can(action, { type, id, createdBy: m.get(id)! }); // #731: test",
      "const o = { createdBy: ctx.userId };",
    ]) {
      expect([ok, permissionObjectViolations(ok)]).toEqual([ok, []]);
    }
  });
});

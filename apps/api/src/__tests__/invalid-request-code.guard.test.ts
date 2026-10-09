/**
 * #742: a malformed request is a 400 with a `*_INVALID_*` code, never a
 * `*_NOT_FOUND` one. Clients key off `code`, so `400 PORTAL_NOT_FOUND` on a
 * bad body read as "the portal is gone" (#706 fixed the station routes the
 * same way).
 *
 * Scans the API source with the TypeScript AST for
 * `new ApiError(400, ApiCode.<X>_NOT_FOUND, …)` and
 * `invalidPayload(ApiCode.<X>_NOT_FOUND, …)`, including either branch of a
 * conditional code. A status or code held in a variable isn't followed; none
 * exist today. The allowlist holds the 400s
 * that genuinely are a not-found *reference* inside an otherwise valid
 * request. It only shrinks, and an entry that no longer exists fails too.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** `file → code`: a valid body that names something that doesn't exist. */
const ALLOWED: Array<{ file: string; code: string }> = [
  // A bidirectional mapping names a target mapping that doesn't exist.
  {
    file: "routes/field-mapping.router.ts",
    code: "FIELD_MAPPING_BIDIRECTIONAL_TARGET_NOT_FOUND",
  },
  // A bulk job names a tool that isn't bulk-dispatchable on the station.
  {
    file: "queues/processors/bulk-transform.processor.ts",
    code: "BULK_DISPATCH_TOOL_NOT_FOUND",
  },
  // 403 "you aren't a member of this organization": the caller's own
  // membership is what's missing, not an object they asked for.
  { file: "services/application.service.ts", code: "MEMBERSHIP_NOT_FOUND" },
  {
    file: "services/connector-instance-access.service.ts",
    code: "MEMBERSHIP_NOT_FOUND",
  },
];

/** The `*_NOT_FOUND` codes an expression can evaluate to: `ApiCode.X`, or
 *  either branch of a conditional (code review on #744). */
function notFoundCodes(e: ts.Expression, sf: ts.SourceFile): string[] {
  if (ts.isParenthesizedExpression(e)) return notFoundCodes(e.expression, sf);
  if (ts.isConditionalExpression(e)) {
    return [
      ...notFoundCodes(e.whenTrue, sf),
      ...notFoundCodes(e.whenFalse, sf),
    ];
  }
  const m = /^ApiCode\.(\w+_NOT_FOUND)$/.exec(e.getText(sf));
  return m ? [m[1]] : [];
}

/** Every non-404 4xx with a `*_NOT_FOUND` code in `source`: a direct
 *  `new ApiError(4xx, ApiCode.*_NOT_FOUND, …)`, or the shared
 *  `invalidPayload(ApiCode.*_NOT_FOUND, …)` helper, which is always a 400.
 *  #743 widened it from 400: a 403 "belongs to another organization" told
 *  callers the object existed. */
export function notFound400s(source: string): string[] {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isNewExpression(n) &&
      n.expression.getText(sf) === "ApiError" &&
      n.arguments &&
      n.arguments.length >= 2 &&
      /^4\d\d$/.test(n.arguments[0].getText(sf)) &&
      n.arguments[0].getText(sf) !== "404"
    ) {
      out.push(...notFoundCodes(n.arguments[1], sf));
    } else if (
      ts.isCallExpression(n) &&
      n.expression.getText(sf) === "invalidPayload" &&
      n.arguments.length >= 1
    ) {
      out.push(...notFoundCodes(n.arguments[0], sf));
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

describe("non-404 4xx never claims a missing object (#742, #743)", () => {
  const found = sourceFiles(apiSrc).flatMap((path) =>
    notFound400s(readFileSync(path, "utf8")).map((code) => ({
      file: relative(apiSrc, path),
      code,
    }))
  );

  it("no non-404 4xx uses a *_NOT_FOUND code outside the allowlist", () => {
    const offenders = found
      .filter(
        (f) => !ALLOWED.some((a) => a.file === f.file && a.code === f.code)
      )
      .map((f) => `${f.file}: ${f.code}`);
    expect(offenders).toEqual([]);
  });

  it("every allowlist entry still exists (the list only shrinks)", () => {
    for (const a of ALLOWED) {
      expect([
        a,
        found.some((f) => f.file === a.file && f.code === a.code),
      ]).toEqual([a, true]);
    }
  });

  it("catches a 400 with a *_NOT_FOUND code, and ignores others", () => {
    expect(
      notFound400s(
        'throw new ApiError(400, ApiCode.PORTAL_NOT_FOUND, "Invalid portal payload");'
      )
    ).toEqual(["PORTAL_NOT_FOUND"]);
    // #743: a 403 (or any non-404 4xx) is flagged too.
    expect(
      notFound400s(
        'new ApiError(403, ApiCode.CONNECTOR_INSTANCE_NOT_FOUND, "belongs to a different organization");'
      )
    ).toEqual(["CONNECTOR_INSTANCE_NOT_FOUND"]);
    // Through the shared helper, and in either branch of a conditional.
    expect(
      notFound400s(
        'invalidPayload(ApiCode.PORTAL_NOT_FOUND, "Invalid portal payload", e);'
      )
    ).toEqual(["PORTAL_NOT_FOUND"]);
    expect(
      notFound400s(
        "new ApiError(400, kind ? ApiCode.PORTAL_NOT_FOUND : (ApiCode.PIN_NOT_FOUND), m);"
      )
    ).toEqual(["PORTAL_NOT_FOUND", "PIN_NOT_FOUND"]);
    expect(
      notFound400s(
        [
          'new ApiError(404, ApiCode.PORTAL_NOT_FOUND, "Portal not found");',
          'new ApiError(400, ApiCode.PORTAL_INVALID_PAYLOAD, "bad");',
          'invalidPayload(ApiCode.PORTAL_INVALID_PAYLOAD, "x", e);',
        ].join("\n")
      )
    ).toEqual([]);
  });
});

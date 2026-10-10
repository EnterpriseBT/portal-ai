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
 *
 * #745 adds the second rule: a request that fails its schema answers through
 * `invalidPayload`, so the first issue is in the message and every issue is
 * in `details`. `schemaFailure400s` flags a hand-built 400 in a routes file
 * that sits in an `if (!x.success)` branch or carries `issues` by hand.
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

/** #745: routes still building a schema-failure 400 by hand. Each conversion
 *  batch deletes its entries; it only shrinks, and is empty when #745 lands. */
const SCHEMA_FAILURE_ALLOWED: Array<{ file: string; code: string }> = [
  { file: "routes/api-endpoints.router.ts", code: "REST_API_INVALID_CONFIG" },
  {
    file: "routes/column-definition.router.ts",
    code: "COLUMN_DEFINITION_INVALID_PAYLOAD",
  },
  {
    file: "routes/connector-entity.router.ts",
    code: "CONNECTOR_ENTITY_INVALID_PAYLOAD",
  },
  {
    file: "routes/connector-instance-layout-plans.router.ts",
    code: "LAYOUT_PLAN_INVALID_PAYLOAD",
  },
  {
    file: "routes/connector-instance.router.ts",
    code: "CONNECTOR_INSTANCE_INVALID_PAYLOAD",
  },
  {
    file: "routes/connector-instance.router.ts",
    code: "REST_API_INVALID_CONFIG",
  },
  {
    file: "routes/curated-view.router.ts",
    code: "CURATED_VIEW_INVALID_PAYLOAD",
  },
  { file: "routes/curated-view.router.ts", code: "CURATED_VIEW_INVALID_QUERY" },
  {
    file: "routes/entity-group-member.router.ts",
    code: "ENTITY_GROUP_MEMBER_CREATE_FAILED",
  },
  {
    file: "routes/entity-group-member.router.ts",
    code: "ENTITY_GROUP_MEMBER_FETCH_FAILED",
  },
  {
    file: "routes/entity-group-member.router.ts",
    code: "ENTITY_GROUP_MEMBER_UPDATE_FAILED",
  },
  {
    file: "routes/entity-group.router.ts",
    code: "ENTITY_GROUP_INVALID_PAYLOAD",
  },
  {
    file: "routes/entity-record.router.ts",
    code: "ENTITY_RECORD_INVALID_PAYLOAD",
  },
  {
    file: "routes/entity-record.router.ts",
    code: "ENTITY_RECORD_INVALID_QUERY",
  },
  {
    file: "routes/entity-tag-assignment.router.ts",
    code: "ENTITY_TAG_ASSIGNMENT_CREATE_FAILED",
  },
  { file: "routes/entity-tag.router.ts", code: "ENTITY_TAG_INVALID_PAYLOAD" },
  {
    file: "routes/field-mapping.router.ts",
    code: "FIELD_MAPPING_INVALID_PAYLOAD",
  },
  {
    file: "routes/file-uploads.router.ts",
    code: "FILE_UPLOAD_PARSE_INVALID_PAYLOAD",
  },
  {
    file: "routes/layout-plans.router.ts",
    code: "LAYOUT_PLAN_INVALID_PAYLOAD",
  },
  { file: "routes/toolpacks.router.ts", code: "TOOLPACK_INVALID_PAYLOAD" },
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

/** True when `e` contains a `!<x>.success` (through parentheses and compound
 *  conditions), the way every route spells a failed `safeParse`. */
function negatesSuccess(e: ts.Node): boolean {
  if (
    ts.isPrefixUnaryExpression(e) &&
    e.operator === ts.SyntaxKind.ExclamationToken
  ) {
    let operand: ts.Expression = e.operand;
    while (ts.isParenthesizedExpression(operand)) operand = operand.expression;
    if (
      ts.isPropertyAccessExpression(operand) &&
      operand.name.text === "success"
    ) {
      return true;
    }
  }
  return ts.forEachChild(e, negatesSuccess) ?? false;
}

/** True when `n` sits in the then-branch of an `if (!x.success)`, without
 *  crossing into a nested function (a callback is a different scope). */
function inSchemaFailureBranch(n: ts.Node): boolean {
  let child: ts.Node = n;
  for (let p = n.parent; p; child = p, p = p.parent) {
    if (ts.isFunctionLike(p)) return false;
    if (
      ts.isIfStatement(p) &&
      p.thenStatement === child &&
      negatesSuccess(p.expression)
    ) {
      return true;
    }
  }
  return false;
}

/** #745: every `new ApiError(400, …)` built by hand for a request that
 *  failed its schema, so its issues may be missing or its message generic.
 *  Flags one inside the then-branch of an `if (!x.success)` (R1), or one whose
 *  details carry `issues` by hand (R2). Such a failure answers through
 *  `invalidPayload(code, label, parsed.error)` instead. */
export function schemaFailure400s(
  source: string
): Array<{ line: number; code: string }> {
  const sf = ts.createSourceFile("x.ts", source, ts.ScriptTarget.Latest, true);
  const out: Array<{ line: number; code: string }> = [];
  const visit = (n: ts.Node): void => {
    if (
      ts.isNewExpression(n) &&
      n.expression.getText(sf) === "ApiError" &&
      n.arguments &&
      n.arguments.length >= 2 &&
      n.arguments[0].getText(sf) === "400"
    ) {
      const details = n.arguments[3];
      const handIssues =
        details !== undefined &&
        ts.isObjectLiteralExpression(details) &&
        details.properties.some((p) => p.name?.getText(sf) === "issues");
      if (handIssues || inSchemaFailureBranch(n)) {
        out.push({
          line: sf.getLineAndCharacterOfPosition(n.getStart(sf)).line + 1,
          code: n.arguments[1].getText(sf).replace(/^ApiCode\./, ""),
        });
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

describe("a schema failure answers through invalidPayload (#745)", () => {
  const routesDir = join(apiSrc, "routes");
  const found = sourceFiles(routesDir).flatMap((path) =>
    schemaFailure400s(readFileSync(path, "utf8")).map((f) => ({
      file: relative(apiSrc, path),
      ...f,
    }))
  );

  it("no route builds a schema-failure 400 by hand outside the allowlist", () => {
    const offenders = found
      .filter(
        (f) =>
          !SCHEMA_FAILURE_ALLOWED.some(
            (a) => a.file === f.file && a.code === f.code
          )
      )
      .map((f) => `${f.file}:${f.line}: ${f.code}`);
    expect(offenders).toEqual([]);
  });

  it("every allowlist entry still exists (the list only shrinks)", () => {
    for (const a of SCHEMA_FAILURE_ALLOWED) {
      expect([
        a,
        found.some((f) => f.file === a.file && f.code === a.code),
      ]).toEqual([a, true]);
    }
  });

  it("flags a 400 built by hand in a !x.success branch", () => {
    // Braced, brace-less, and a compound condition.
    expect(
      schemaFailure400s(
        [
          "if (!parsed.success) {",
          '  return next(new ApiError(400, ApiCode.GROUP_INVALID_PAYLOAD, "Invalid group payload"));',
          "}",
          'if (!body.success) throw new ApiError(400, ApiCode.ROLE_INVALID_PAYLOAD, "bad");',
          'if (!rt.success || typeof id !== "string") return next(new ApiError(400, ApiCode.GRANT_INVALID_PAYLOAD, "x"));',
        ].join("\n")
      )
    ).toEqual([
      { line: 2, code: "GROUP_INVALID_PAYLOAD" },
      { line: 4, code: "ROLE_INVALID_PAYLOAD" },
      { line: 5, code: "GRANT_INVALID_PAYLOAD" },
    ]);
  });

  it("flags the 400 inside a nested block of the failure branch", () => {
    expect(
      schemaFailure400s(
        [
          "if (!(parsed.success)) {",
          "  if (strict) {",
          "    { return next(new ApiError(400, ApiCode.X_INVALID_QUERY, m)); }",
          "  }",
          "}",
        ].join("\n")
      )
    ).toEqual([{ line: 3, code: "X_INVALID_QUERY" }]);
  });

  it("flags a 400 that carries the issues by hand, in any branch", () => {
    expect(
      schemaFailure400s(
        "throw new ApiError(400, ApiCode.REST_API_INVALID_CONFIG, `Invalid: ${m}`, { issues: e.issues });"
      )
    ).toEqual([{ line: 1, code: "REST_API_INVALID_CONFIG" }]);
  });

  it("ignores invalidPayload, non-400s, semantic checks and else branches", () => {
    expect(
      schemaFailure400s(
        [
          "if (!parsed.success) {",
          '  return next(invalidPayload(ApiCode.PORTAL_INVALID_PAYLOAD, "Invalid portal payload", parsed.error));',
          "}",
          // A response self-check is a 500, not the caller's error.
          'if (!out.success) throw new ApiError(500, ApiCode.CONFIG_INVALID, "bad config", { issues: out.error.issues });',
          // A hand-written semantic check is not a schema failure.
          'if (!name) return next(new ApiError(400, ApiCode.PORTAL_INVALID_PAYLOAD, "name is required"));',
          'if (!parsed.success) { log(); } else { next(new ApiError(400, ApiCode.X_CONFLICT, "dup")); }',
          // A callback declared in the branch is a different scope.
          'if (!p.success) { run(() => new ApiError(400, ApiCode.Y_INVALID_PAYLOAD, "later")); }',
        ].join("\n")
      )
    ).toEqual([]);
  });
});

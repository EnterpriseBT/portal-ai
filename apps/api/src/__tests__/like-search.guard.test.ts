/**
 * #1039: a list search matches its text literally.
 *
 * Every list search was `ilike(col, `%${search}%`)`, which leaves `%` and `_`
 * as LIKE wildcards: a search for `%` returned every row the caller could see,
 * and `Q1_2025` also matched `Q1X2025`. A search goes through
 * `ilikeContains` (utils/filter-sql.util.ts; admin-cli's store keeps its own
 * copy, since it can't import the API), which escapes the term with a
 * backslash and states `ESCAPE '\'`.
 *
 * Scans the API and the operator CLIs' source (they query the same database)
 * with the TypeScript AST and fails on:
 * - importing drizzle's `like` / `ilike` / `notLike` / `notIlike`, under any
 *   alias, or calling one (a bare call, or through a namespace import). They
 *   take a raw pattern, so every caller would have to remember to escape it;
 * - a `sql` tagged template that interpolates a value into a LIKE / ILIKE /
 *   `~~` pattern (`ILIKE ${term}`, `ILIKE '%' || ${term} || '%'`,
 *   `ILIKE ANY(${terms})`) without `ESCAPE '\'` after it. The escape
 *   character must be the backslash `escapeLike` writes: under any other one
 *   an escaped `\%` is a literal backslash and a wildcard. A constant pattern
 *   written in the SQL (`relname LIKE 'er\\_\\_%'`) carries no user text and
 *   isn't flagged.
 *
 * A raw-string query (portal-sql.service.ts builds plain strings through
 * `quoteLiteral`) isn't a `sql` template; it escapes with `escapeLike` and
 * writes the same `ESCAPE '\'` by hand.
 */
import { describe, it, expect } from "@jest/globals";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = join(apiSrc, "..", "..", "..");
const ROOTS = [
  "apps/api/src",
  "packages/admin-cli/src",
  "packages/devops-cli/src",
].map((r) => join(repoRoot, r));

const RAW_PATTERN_FNS = new Set(["like", "ilike", "notLike", "notIlike"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" || name === "node_modules"
        ? []
        : sourceFiles(path);
    }
    return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

const isDrizzle = (spec: ts.Expression) =>
  ts.isStringLiteral(spec) && /^drizzle-orm(\/|$)/.test(spec.text);

// A string literal (`'…'`, `''` escapes a quote) then `||`.
const QUOTED = String.raw`'(?:[^']|'')*'`;
// Text before a `${…}` that makes it (part of) a LIKE pattern.
const PATTERN_BEFORE = new RegExp(
  String.raw`(\bI?LIKE|~~\*?)\s*(ANY\s*\(\s*)?(${QUOTED}\s*\|\|\s*)?$`,
  "i"
);
// What must follow it: the rest of a concatenation, then `ESCAPE '\'`.
const ESCAPE_AFTER = new RegExp(
  String.raw`^(\s*\|\|\s*${QUOTED})?\s*\)?\s*ESCAPE\s+'\\'`,
  "i"
);

/** Whether some `${…}` is a LIKE pattern without `ESCAPE '\'` after it. */
function hasUnescapedLikeValue(t: ts.TemplateLiteral): boolean {
  if (ts.isNoSubstitutionTemplateLiteral(t)) return false;
  const chunks = [t.head.text, ...t.templateSpans.map((s) => s.literal.text)];
  return chunks.some(
    (before, i) =>
      i < chunks.length - 1 &&
      PATTERN_BEFORE.test(before) &&
      !ESCAPE_AFTER.test(chunks[i + 1])
  );
}

/** Offending `line: reason` entries in one source file. */
function findViolations(text: string, fileName = "fixture.ts"): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const report = (node: ts.Node, why: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push(`${line + 1}: ${why}`);
  };
  const namespaces = new Set<string>();
  const visit = (node: ts.Node) => {
    if (ts.isImportDeclaration(node) && isDrizzle(node.moduleSpecifier)) {
      const bindings = node.importClause?.namedBindings;
      if (bindings && ts.isNamespaceImport(bindings)) {
        namespaces.add(bindings.name.text);
      }
      if (bindings && ts.isNamedImports(bindings)) {
        for (const el of bindings.elements) {
          const imported = (el.propertyName ?? el.name).text;
          if (RAW_PATTERN_FNS.has(imported)) {
            report(el, `imports drizzle's ${imported}, a raw LIKE pattern`);
          }
        }
      }
    }
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      if (ts.isIdentifier(callee) && RAW_PATTERN_FNS.has(callee.text)) {
        report(node, `${callee.text}(…) takes a raw LIKE pattern`);
      }
      if (
        ts.isPropertyAccessExpression(callee) &&
        ts.isIdentifier(callee.expression) &&
        namespaces.has(callee.expression.text) &&
        RAW_PATTERN_FNS.has(callee.name.text)
      ) {
        report(node, `${callee.name.text}(…) takes a raw LIKE pattern`);
      }
    }
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === "sql" &&
      hasUnescapedLikeValue(node.template)
    ) {
      report(node, "sql`… LIKE ${value}` without ESCAPE '\\'");
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("LIKE search guard (#1039)", () => {
  it("flags drizzle's raw-pattern functions however they're imported", () => {
    expect(
      findViolations(
        'import { ilike } from "drizzle-orm";\nconst c = ilike(t.name, `%${search}%`);'
      )
    ).toEqual([
      "1: imports drizzle's ilike, a raw LIKE pattern",
      "2: ilike(…) takes a raw LIKE pattern",
    ]);
    expect(
      findViolations(
        'import { ilike as iLike } from "drizzle-orm";\nconst c = iLike(t.name, s);'
      )
    ).toEqual(["1: imports drizzle's ilike, a raw LIKE pattern"]);
    expect(
      findViolations(
        'import * as d from "drizzle-orm";\nconst c = d.notIlike(t.name, s);'
      )
    ).toEqual(["2: notIlike(…) takes a raw LIKE pattern"]);
  });

  it.each([
    ["a bare value", "sql`${col} ILIKE ${term}`"],
    ["a NOT LIKE", "sql`${col} not like ${term}`"],
    ["a concatenated pattern", "sql`${col} ILIKE '%' || ${term} || '%'`"],
    ["an ANY(…) pattern", "sql`${col} ILIKE ANY(${terms})`"],
    ["the ~~* operator", "sql`${col} ~~* ${term}`"],
    ["another escape character", "sql`${col} ILIKE ${term} ESCAPE '!'`"],
    ["one of two unescaped", "sql`a LIKE ${x} OR b ILIKE ${y} ESCAPE '\\\\'`"],
  ])("flags %s", (_label, code) => {
    expect(findViolations(`const c = ${code};`)).toHaveLength(1);
  });

  it("allows the escaped forms", () => {
    expect(
      findViolations(
        "const a = ilikeContains(t.name, search);\n" +
          "const b = sql`${col} ILIKE ${term} ESCAPE '\\\\'`;\n" +
          "const c = sql`${col} ILIKE '%' || ${term} || '%' ESCAPE '\\\\'`;\n" +
          "// ilike(t.name, `%${search}%`) in a comment\n" +
          "const d = `w.x ILIKE ${quoteLiteral(term)}`;\n" +
          "const e = sql`relname LIKE 'pg\\\\_temp%' AND id = ${id}`;\n" +
          'import { eq, sql } from "drizzle-orm";'
      )
    ).toEqual([]);
  });

  it("finds no raw LIKE pattern in the API or CLI source", () => {
    const roots = ROOTS.filter((r) => existsSync(r));
    expect(roots).toHaveLength(ROOTS.length);
    const violations = roots.flatMap((root) =>
      sourceFiles(root).flatMap((path) =>
        findViolations(readFileSync(path, "utf8"), path).map(
          (v) => `${relative(repoRoot, path)}:${v}`
        )
      )
    );
    expect(violations).toEqual([]);
  });
});

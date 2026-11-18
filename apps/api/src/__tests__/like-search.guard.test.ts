/**
 * #1039: a list search matches its text literally.
 *
 * Every list search was `ilike(col, `%${search}%`)`, which leaves `%` and `_`
 * as LIKE wildcards: a search for `%` returned every row the caller could see,
 * and `Q1_2025` also matched `Q1X2025`. A search goes through
 * `ilikeContains` (utils/filter-sql.util.ts), which escapes the term with
 * `escapeLike` and states `ESCAPE '\'`.
 *
 * Scans the API source with the TypeScript AST and fails on:
 * - any call to drizzle's `like` / `ilike` / `notLike` / `notIlike`. They take
 *   a raw pattern, so every caller would have to remember to escape it; use
 *   `ilikeContains`, or a `sql` fragment with `escapeLike` + `ESCAPE`;
 * - a `sql` tagged template that interpolates a value as a LIKE / ILIKE
 *   pattern (`… ILIKE ${term}`) without an `ESCAPE` clause after it. A
 *   constant pattern written in the SQL (`relname LIKE 'er\\_\\_%'`) carries
 *   no user text and isn't flagged.
 *
 * A raw-string query that escapes with `escapeLike` (portal-sql.service.ts
 * builds plain strings through `quoteLiteral`) isn't a `sql` template and
 * isn't flagged.
 */
import { describe, it, expect } from "@jest/globals";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";
import ts from "typescript";

const apiSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

const RAW_PATTERN_FNS = new Set(["like", "ilike", "notLike", "notIlike"]);

function sourceFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) {
      return name === "__tests__" ? [] : sourceFiles(path);
    }
    return /\.ts$/.test(name) && !/\.d\.ts$/.test(name) ? [path] : [];
  });
}

/** Whether some `${…}` sits right after LIKE/ILIKE with no ESCAPE after it. */
function hasUnescapedLikeValue(t: ts.TemplateLiteral): boolean {
  if (ts.isNoSubstitutionTemplateLiteral(t)) return false;
  const chunks = [t.head.text, ...t.templateSpans.map((s) => s.literal.text)];
  return chunks.some(
    (before, i) =>
      i < chunks.length - 1 &&
      /\bI?LIKE\s*$/i.test(before) &&
      !/^\s*ESCAPE\b/i.test(chunks[i + 1])
  );
}

/** Offending `line: snippet` entries in one source file. */
function findViolations(text: string, fileName = "fixture.ts"): string[] {
  const sf = ts.createSourceFile(fileName, text, ts.ScriptTarget.Latest, true);
  const out: string[] = [];
  const report = (node: ts.Node, why: string) => {
    const { line } = sf.getLineAndCharacterOfPosition(node.getStart(sf));
    out.push(`${line + 1}: ${why}`);
  };
  const visit = (node: ts.Node) => {
    if (
      ts.isCallExpression(node) &&
      ts.isIdentifier(node.expression) &&
      RAW_PATTERN_FNS.has(node.expression.text)
    ) {
      report(node, `${node.expression.text}(…) takes a raw LIKE pattern`);
    }
    if (
      ts.isTaggedTemplateExpression(node) &&
      ts.isIdentifier(node.tag) &&
      node.tag.text === "sql"
    ) {
      if (hasUnescapedLikeValue(node.template)) {
        report(node, "sql`… LIKE ${value}` without an ESCAPE clause");
      }
    }
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return out;
}

describe("LIKE search guard (#1039)", () => {
  it("flags the raw patterns it exists to catch", () => {
    expect(
      findViolations(
        'import { ilike } from "drizzle-orm";\nconst c = ilike(t.name, `%${search}%`);'
      )
    ).toEqual(["2: ilike(…) takes a raw LIKE pattern"]);
    expect(findViolations("const c = sql`${col} ILIKE ${term}`;")).toEqual([
      "1: sql`… LIKE ${value}` without an ESCAPE clause",
    ]);
    expect(
      findViolations("const c = sql`a like ${x} or b ILIKE ${y} ESCAPE '!'`;")
    ).toHaveLength(1);
  });

  it("allows the escaped forms", () => {
    expect(
      findViolations(
        "const a = ilikeContains(t.name, search);\n" +
          "const b = sql`${col} ILIKE ${term} ESCAPE '\\\\'`;\n" +
          "// ilike(t.name, `%${search}%`) in a comment\n" +
          "const d = `w.x ILIKE ${quoteLiteral(term)}`;\n" +
          "const e = sql`relname LIKE 'pg\\\\_temp%' AND id = ${id}`;"
      )
    ).toEqual([]);
  });

  it("finds no raw LIKE pattern in the API source", () => {
    const violations = sourceFiles(apiSrc).flatMap((path) =>
      findViolations(readFileSync(path, "utf8"), path).map(
        (v) => `${relative(apiSrc, path)}:${v}`
      )
    );
    expect(violations).toEqual([]);
  });
});

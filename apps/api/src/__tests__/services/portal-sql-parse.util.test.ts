/**
 * #660: `libpg-query` (Postgres 17's own parser) is the single SQL parser
 * for the agent SQL surface. These pin what the AST walk reports — the
 * relations and functions a statement references, wherever they appear —
 * which the relation/function gates (later slices) enforce.
 */
import { describe, it, expect } from "@jest/globals";

import {
  parsePortalSql,
  parsePortalSqlExpression,
} from "../../services/portal-sql-parse.util.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

const rels = (sql: string) => [...parsePortalSql(sql).relations].sort();
const fns = (sql: string) => [...parsePortalSql(sql).functions].sort();

describe("parsePortalSql — relations (#660)", () => {
  it("collects FROM and JOIN relations", () => {
    expect(rels("SELECT * FROM contacts c JOIN deals d ON d.x = c.x")).toEqual([
      "contacts",
      "deals",
    ]);
  });

  it("collects relations inside WHERE sub-selects and scalar sub-selects", () => {
    expect(
      rels(
        "SELECT (SELECT max(y) FROM hidden_a), x FROM contacts WHERE x IN (SELECT x FROM er__abc)"
      )
    ).toEqual(["contacts", "er__abc", "hidden_a"]);
  });

  it("collects relations inside CTE bodies but not the CTE names themselves", () => {
    expect(
      rels(
        "WITH recent AS (SELECT * FROM entity_records) SELECT * FROM recent JOIN contacts USING (x)"
      )
    ).toEqual(["contacts", "entity_records"]);
  });

  it("resolves CTE names by scope — a later sibling or out-of-scope name is a real relation", () => {
    // A non-recursive CTE body can't see a LATER sibling: Postgres resolves
    // `er__x` in `a` to the real table, so it must be reported.
    expect(
      rels(
        "WITH a AS (SELECT * FROM er__x), er__x AS (SELECT 1) SELECT * FROM a"
      )
    ).toEqual(["er__x"]);
    // A CTE defined inside a subquery doesn't shadow the same name outside it.
    expect(
      rels(
        "SELECT * FROM (WITH er__y AS (SELECT 1) SELECT * FROM er__y) s, er__y"
      )
    ).toEqual(["er__y"]);
    // A recursive CTE body may reference itself.
    expect(
      rels(
        "WITH RECURSIVE t(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM t WHERE n < 3) SELECT * FROM t"
      )
    ).toEqual([]);
  });

  it("collects LATERAL, TABLE and set-operation relations", () => {
    expect(
      rels(
        "SELECT * FROM contacts c, LATERAL (SELECT * FROM deals d WHERE d.x = c.x) l UNION ALL TABLE other_t"
      )
    ).toEqual(["contacts", "deals", "other_t"]);
  });

  it("reports quoted and schema-qualified names by relname (qualification is judged separately)", () => {
    const parsed = parsePortalSql('SELECT * FROM "pg_catalog"."pg_roles"');
    expect([...parsed.relations]).toEqual(["pg_roles"]);
    expect(parsed.qualifiedRelations).toEqual(["pg_catalog.pg_roles"]);
  });
});

describe("parsePortalSql — functions (#660)", () => {
  it("collects every function call, lower-cased, wherever it appears", () => {
    expect(
      fns(
        "SELECT COUNT(*), upper(name) FROM contacts WHERE set_config('role','x',true) IS NOT NULL ORDER BY Lower(name)"
      )
    ).toEqual(["count", "lower", "set_config", "upper"]);
  });

  it("collects set-returning functions in FROM and keeps a pg_catalog qualifier", () => {
    expect(
      fns("SELECT * FROM generate_series(1, 3) g, pg_catalog.lower('A') l")
    ).toEqual(["generate_series", "pg_catalog.lower"]);
  });
});

describe("parsePortalSql — needsImplicitLimit parity (#660)", () => {
  const needs = (sql: string) => parsePortalSql(sql).needsImplicitLimit;

  it("a bare SELECT needs the implicit LIMIT", () => {
    expect(needs("SELECT * FROM contacts")).toBe(true);
    expect(needs("SELECT 1")).toBe(true);
  });

  it("an explicit LIMIT does not", () => {
    expect(needs("SELECT * FROM contacts LIMIT 10")).toBe(false);
  });

  it("a top-level aggregate does not (including GROUP BY + AVG)", () => {
    expect(needs("SELECT COUNT(*) FROM contacts")).toBe(false);
    expect(needs("SELECT region, AVG(amount) FROM deals GROUP BY region")).toBe(
      false
    );
  });

  it("ORDER BY without LIMIT still needs it; a window function is not an aggregate", () => {
    expect(needs("SELECT * FROM contacts ORDER BY name")).toBe(true);
    expect(needs("SELECT row_number() OVER () FROM contacts")).toBe(true);
    expect(needs("SELECT count(*) OVER () FROM contacts")).toBe(true);
  });

  it("an aggregate only inside a subquery does not count as top-level", () => {
    expect(needs("SELECT * FROM (SELECT count(*) AS n FROM contacts) s")).toBe(
      true
    );
  });
});

describe("parsePortalSql — rejections (#660)", () => {
  const code = (sql: string) => {
    try {
      parsePortalSql(sql);
      return null;
    } catch (e) {
      expect(e).toBeInstanceOf(ApiError);
      return { code: (e as ApiError).code, message: (e as ApiError).message };
    }
  };

  it("a syntax error is a PORTAL_SQL_FORBIDDEN 'syntax error: …'", () => {
    const r = code("SELEC * FROM contacts");
    expect(r?.code).toBe(ApiCode.PORTAL_SQL_FORBIDDEN);
    expect(r?.message).toMatch(/^syntax error: /);
  });

  it("more than one statement is rejected", () => {
    expect(code("SELECT 1; SELECT 2")?.message).toBe(
      "exactly one statement is allowed"
    );
  });
});

describe("parsePortalSqlExpression — transform fragments (#660)", () => {
  const rejects = (f: string, kind: "target" | "where", msg: RegExp) =>
    expect(() => parsePortalSqlExpression(f, kind)).toThrow(msg);

  it("accepts scalar projections (with aliases) and predicates over the source row", () => {
    expect(() =>
      parsePortalSqlExpression("c_a * 2 AS doubled, upper(c_b) AS b", "target")
    ).not.toThrow();
    expect(() =>
      parsePortalSqlExpression("c_parcel_id IN ('p-99','p-499')", "where")
    ).not.toThrow();
  });

  it("rejects any sub-select — the cross-tenant exfiltration shape", () => {
    rejects("(SELECT max(c) FROM er__x) AS stolen", "target", /subquer/i);
    rejects("c_a IN (SELECT c FROM entity_records)", "where", /subquer/i);
    rejects("EXISTS (SELECT 1 FROM users)", "where", /subquer/i);
  });

  it("rejects smuggling a relation by closing the wrapper", () => {
    rejects(
      "c_a FROM entity_records --",
      "target",
      /unknown entity: entity_records|syntax error/
    );
    rejects(
      "1 = 1) UNION SELECT secret FROM er__y WHERE (1 = 1",
      "where",
      /unknown entity|subquer|syntax error/
    );
  });

  it("rejects disallowed functions and multi-statement", () => {
    rejects(
      "set_config('role','x',true)",
      "target",
      /function not allowed: set_config/
    );
    rejects("1; DROP TABLE x", "where", /statement|syntax error/);
  });
});

// #660 code-review F3: a set operation's branches (larg/rarg) arrive as bare
// select objects without the SelectStmt wrapper — they must still open their
// own CTE scope and have INTO / locking clauses checked.
describe("parsePortalSql — set-operation branches (#660)", () => {
  it("a WITH inside a UNION branch scopes its CTE to that branch", () => {
    expect(
      rels("SELECT a FROM v UNION (WITH c AS (SELECT 1 AS a) SELECT a FROM c)")
    ).toEqual(["v"]);
    // …but the branch's CTE does not shadow the same name in the other branch.
    expect(
      rels("SELECT a FROM c UNION (WITH c AS (SELECT 1 AS a) SELECT a FROM c)")
    ).toEqual(["c"]);
  });

  it("flags a locking clause on a set-operation branch", () => {
    expect(
      parsePortalSql("SELECT a FROM v UNION ALL (SELECT a FROM v FOR SHARE)")
        .intoOrLocking
    ).toBe(true);
  });

  it("still reports relations in every branch", () => {
    expect(
      rels("SELECT a FROM v UNION SELECT a FROM er__x EXCEPT SELECT a FROM w")
    ).toEqual(["er__x", "v", "w"]);
  });
});

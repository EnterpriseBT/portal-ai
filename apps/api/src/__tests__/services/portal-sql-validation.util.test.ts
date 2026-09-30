/**
 * Unit tests for `validatePortalSql` (Phase 3 slice 0).
 *
 * Covers the three deny-list stages — comment stripping, multi-statement
 * detection, reserved-verb / system-catalog regex — plus the AST-driven
 * `needsImplicitLimit` flag.
 */

import { describe, it, expect } from "@jest/globals";

import { validatePortalSql } from "../../services/portal-sql-validation.util.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

function expectForbidden(sql: string, fragment: string): void {
  try {
    validatePortalSql(sql);
    throw new Error("expected validatePortalSql to throw");
  } catch (err) {
    const e = err as { code?: string; message?: string };
    expect(e.code).toBe(ApiCode.PORTAL_SQL_FORBIDDEN);
    expect(e.message?.toLowerCase()).toContain(fragment.toLowerCase());
  }
}

describe("validatePortalSql", () => {
  // ── needsImplicitLimit flag ────────────────────────────────────

  it("flags a bare SELECT for implicit-LIMIT wrapping", () => {
    const { needsImplicitLimit } = validatePortalSql("SELECT 1");
    expect(needsImplicitLimit).toBe(true);
  });

  it("passes through queries with an explicit LIMIT", () => {
    const { needsImplicitLimit } = validatePortalSql(
      "SELECT * FROM contacts LIMIT 10"
    );
    expect(needsImplicitLimit).toBe(false);
  });

  it("passes through queries with a top-level aggregation", () => {
    const { needsImplicitLimit } = validatePortalSql(
      "SELECT COUNT(*) FROM contacts"
    );
    expect(needsImplicitLimit).toBe(false);
  });

  it("passes through GROUP BY + COUNT", () => {
    const { needsImplicitLimit } = validatePortalSql(
      "SELECT name, COUNT(*) FROM contacts GROUP BY name"
    );
    expect(needsImplicitLimit).toBe(false);
  });

  // ── Reserved verbs ─────────────────────────────────────────────

  it("rejects every DML verb", () => {
    expectForbidden("INSERT INTO contacts (id) VALUES (1)", "INSERT");
    expectForbidden("UPDATE contacts SET a = 1", "UPDATE");
    expectForbidden("DELETE FROM contacts", "DELETE");
    expectForbidden("MERGE INTO contacts USING x ON 1=1", "MERGE");
    expectForbidden("TRUNCATE contacts", "TRUNCATE");
  });

  it("rejects every DDL verb", () => {
    expectForbidden("CREATE TABLE x (a int)", "CREATE");
    expectForbidden("ALTER TABLE contacts ADD COLUMN x text", "ALTER");
    expectForbidden("DROP TABLE contacts", "DROP");
    expectForbidden("GRANT SELECT ON contacts TO public", "GRANT");
    expectForbidden("REVOKE SELECT ON contacts FROM public", "REVOKE");
  });

  it("rejects side-effect verbs", () => {
    expectForbidden("COPY contacts FROM STDIN", "COPY");
    expectForbidden("LISTEN channel", "LISTEN");
    expectForbidden("NOTIFY channel", "NOTIFY");
    expectForbidden("CALL my_proc()", "CALL");
    expectForbidden("DO $$ BEGIN END $$", "DO");
  });

  it("rejects SET / RESET (would change transaction mode)", () => {
    expectForbidden("SET search_path TO public", "SET");
  });

  // ── System catalogs / side-effect functions ────────────────────

  it("rejects pg_catalog access", () => {
    expectForbidden(
      "SELECT * FROM pg_catalog.pg_tables",
      "system catalog access"
    );
  });

  it("rejects pg_* function calls", () => {
    expectForbidden("SELECT pg_sleep(1)", "side-effect function");
  });

  // ── Multi-statement ────────────────────────────────────────────

  it("rejects multi-statement input", () => {
    expectForbidden("SELECT 1; DELETE FROM contacts", "multi-statement input");
  });

  // ── Comment handling ───────────────────────────────────────────

  it("strips line comments before the deny-list scan", () => {
    // The literal `DELETE FROM x` inside a `--` comment must not trip
    // the reserved-verb rule.
    const result = validatePortalSql("-- DELETE FROM contacts\nSELECT 1");
    expect(result.needsImplicitLimit).toBe(true);
  });

  it("strips block comments before the deny-list scan", () => {
    const result = validatePortalSql("/* DELETE FROM contacts */ SELECT 1");
    expect(result.needsImplicitLimit).toBe(true);
  });

  it("does not deny-list a reserved verb inside a string literal", () => {
    const result = validatePortalSql("SELECT 'DELETE FROM x'");
    expect(result.needsImplicitLimit).toBe(true);
  });

  it("does not flag a semicolon inside a string literal as multi-statement", () => {
    // The validator must accept this without throwing — the `;` and
    // `DROP TABLE x` are both inside a string literal.
    const result = validatePortalSql(
      "SELECT '; DROP TABLE x' AS foo FROM contacts"
    );
    // FROM contacts with no LIMIT and no top-level aggregation → wrap.
    expect(result.needsImplicitLimit).toBe(true);
  });

  it("rejects unbalanced block comments", () => {
    expectForbidden("/* SELECT 1", "unbalanced comment");
  });

  it("rejects unbalanced string literals (treated as multi-statement)", () => {
    expectForbidden("SELECT 'unterminated", "unbalanced string literal");
  });
});

// ── #660: the AST gate (libpg-query) — statements, qualification, functions ──
describe("validatePortalSql — #660 AST gate", () => {
  const passes = (sql: string) =>
    expect(() => validatePortalSql(sql)).not.toThrow();

  it("rejects a quoted schema-qualified catalog relation (the reproduced bypass)", () => {
    expectForbidden(
      'SELECT count(*) FROM "pg_catalog"."pg_roles"',
      "schema-qualified relation not allowed: pg_catalog.pg_roles"
    );
    expectForbidden(
      'SELECT * FROM "public"."entity_records"',
      "schema-qualified relation not allowed: public.entity_records"
    );
  });

  it("rejects set_config — it could disable the statement timeout or switch role (reproduced)", () => {
    expectForbidden(
      "SELECT set_config('statement_timeout','0',true)",
      "function not allowed: set_config"
    );
    expectForbidden(
      "SELECT 1 WHERE set_config('role','portalai',true) IS NOT NULL",
      "function not allowed: set_config"
    );
  });

  it("rejects every non-SELECT statement the regex pre-filter might miss", () => {
    // Quoted / unusual spellings the verb regex can't see; the AST can.
    expectForbidden(
      "SELECT * INTO new_t FROM contacts",
      "SELECT INTO / FOR UPDATE not allowed"
    );
    // FOR UPDATE is also caught earlier by the verb pre-filter (UPDATE).
    expectForbidden("SELECT * FROM contacts FOR UPDATE", "UPDATE");
    expectForbidden(
      "SELECT * FROM contacts FOR SHARE",
      "SELECT INTO / FOR UPDATE not allowed"
    );
    // A bare VALUES list parses as a SelectStmt with valuesLists — harmless, allowed.
    expect(() => validatePortalSql("VALUES (1), (2)")).not.toThrow();
  });

  it("rejects functions outside the allowlist, wherever they appear", () => {
    for (const [sql, fn] of [
      // Everything the old regex pre-filter misses (unquoted pg_*/lo_*/dblink/
      // query_to_* are still caught earlier by it, with its own message).
      ["SELECT current_setting('role')", "current_setting"],
      ['SELECT "pg_sleep"(1)', "pg_sleep"],
      ["SELECT nextval('s')", "nextval"],
      ["SELECT postgis_full_version()", "postgis_full_version"],
      ["SELECT txid_current()", "txid_current"],
      [
        "SELECT x FROM contacts WHERE x IN (SELECT inet_server_addr()::text)",
        "inet_server_addr",
      ],
    ] as const) {
      expectForbidden(sql, `function not allowed: ${fn}`);
    }
  });

  it("rejects every schema-qualified function", () => {
    expectForbidden(
      "SELECT public.lower('A')",
      "schema-qualified function not allowed: public.lower"
    );
    expectForbidden(
      "SELECT \"pg_catalog\".\"set_config\"('a','b',true)",
      "schema-qualified function not allowed: pg_catalog.set_config"
    );
  });

  it("allows ordinary analytics SQL: aggregates, windows, math/text/date, JSON, PostGIS st_*", () => {
    passes(
      "SELECT region, count(*), avg(amount), percentile_cont(0.5) WITHIN GROUP (ORDER BY amount), " +
        "stddev_samp(amount), row_number() OVER (ORDER BY region), round(sqrt(abs(sum(amount)))), " +
        "date_trunc('month', max(created_at)), lower(max(name)), coalesce(max(note), '') " +
        "FROM deals GROUP BY region"
    );
    passes(
      "SELECT st_area(geom), st_asgeojson(st_centroid(geom)) FROM parcels"
    );
    passes("SELECT jsonb_extract_path_text(payload, 'status') FROM events");
    passes("SELECT * FROM generate_series(1, 3) g");
  });
});

// #660 code-review F1: Postgres's grammar rewrites SQL-standard syntax into
// pg_catalog-qualified calls (EXTRACT → pg_catalog.extract, trim(both FROM …) →
// pg_catalog.btrim, AT TIME ZONE → pg_catalog.timezone, SIMILAR TO →
// pg_catalog.similar_to_escape, …). Those are ordinary SQL, not a user
// qualifying a function, and must pass.
describe("validatePortalSql — #660 SQL-standard syntax forms", () => {
  it.each([
    "SELECT EXTRACT(year FROM created_at) FROM deals",
    "SELECT substring(name FROM 2 FOR 3) FROM contacts",
    "SELECT substring(name SIMILAR 'a%' ESCAPE '#') FROM contacts",
    "SELECT position('a' IN name) FROM contacts",
    "SELECT trim(both FROM name), trim(leading 'x' FROM name) FROM contacts",
    "SELECT created_at AT TIME ZONE 'UTC' FROM deals",
    "SELECT overlay(name placing 'z' FROM 2) FROM contacts",
    "SELECT * FROM contacts WHERE name SIMILAR TO 'a%'",
    "SELECT normalize(name), name IS NORMALIZED FROM contacts",
  ])("allows %s", (sql) => {
    expect(() => validatePortalSql(sql)).not.toThrow();
  });

  it("still rejects a user-written qualified call of a non-grammar function", () => {
    expectForbidden(
      'SELECT "pg_catalog"."pg_sleep"(1)',
      "schema-qualified function not allowed: pg_catalog.pg_sleep"
    );
  });
});

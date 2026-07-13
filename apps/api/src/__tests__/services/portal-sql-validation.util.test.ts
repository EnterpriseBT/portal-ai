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

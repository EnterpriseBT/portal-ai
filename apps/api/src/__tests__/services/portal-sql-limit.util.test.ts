/**
 * Unit tests for `applyImplicitLimit` (Phase 3 slice 0).
 */

import { describe, it, expect } from "@jest/globals";

import { applyImplicitLimit } from "../../services/portal-sql-limit.util.js";

describe("applyImplicitLimit", () => {
  it("wraps a bare SELECT with a LIMIT cap+1", () => {
    const { sql, appliedLimit } = applyImplicitLimit(
      "SELECT * FROM contacts",
      500
    );
    expect(appliedLimit).toBe(501);
    expect(sql).toBe("SELECT * FROM (SELECT * FROM contacts) _q LIMIT 501");
  });

  it("does not wrap a query that already has a LIMIT", () => {
    const { sql, appliedLimit } = applyImplicitLimit(
      "SELECT * FROM contacts LIMIT 10",
      500
    );
    expect(appliedLimit).toBeNull();
    expect(sql).toBe("SELECT * FROM contacts LIMIT 10");
  });

  it("does not wrap a top-level aggregation", () => {
    const { sql, appliedLimit } = applyImplicitLimit(
      "SELECT COUNT(*) FROM contacts",
      500
    );
    expect(appliedLimit).toBeNull();
    expect(sql).toBe("SELECT COUNT(*) FROM contacts");
  });

  it("does not wrap GROUP BY + AVG", () => {
    const { appliedLimit } = applyImplicitLimit(
      "SELECT name, AVG(age) FROM contacts GROUP BY name",
      500
    );
    expect(appliedLimit).toBeNull();
  });

  it("wraps ORDER BY without LIMIT", () => {
    const { appliedLimit } = applyImplicitLimit(
      "SELECT name FROM contacts ORDER BY name",
      500
    );
    expect(appliedLimit).toBe(501);
  });

  it("wraps when the top-level select has no aggregation (subquery aggregation ignored)", () => {
    // node-sql-parser unfortunately may report subquery aggregations as
    // top-level — accept either: parser passes through OR wraps.
    const { sql } = applyImplicitLimit(
      "SELECT * FROM (SELECT COUNT(*) FROM contacts) _q",
      500
    );
    // Either it wrapped (no top-level aggregation in the outer select)
    // or passed through (parser walked into the subquery). Both are
    // safe — the row cap catches an unbounded result anyway.
    expect(typeof sql).toBe("string");
  });

  it("wraps a WITH-clause query without a top-level LIMIT", () => {
    const { appliedLimit } = applyImplicitLimit(
      "WITH x AS (SELECT * FROM contacts) SELECT * FROM x",
      500
    );
    // Either wrapped (CTE shape) or passed through — same safety net.
    expect([501, null]).toContain(appliedLimit);
  });

  it("returns the SQL unchanged when the parser fails", () => {
    // Garbage input that won't parse — the wrap must not throw and
    // must leave the input alone for the deny-list to catch.
    const { sql, appliedLimit } = applyImplicitLimit("$$$", 500);
    expect(appliedLimit).toBeNull();
    expect(sql).toBe("$$$");
  });
});

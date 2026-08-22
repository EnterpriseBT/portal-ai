/**
 * Unit tests for the entity-record ORDER BY contract (#433).
 *
 * Two rules, both load-bearing:
 *
 * 1. **A unique trailing tiebreaker.** Without one, `ORDER BY <key>` leaves
 *    Postgres free to order ties arbitrarily, and paginating over an
 *    undefined order repeats and skips rows. This is not hypothetical: on
 *    app-dev `synced_at` and `c_geometry_type` each have exactly ONE distinct
 *    value across 283,000 rows, and both are sortable.
 *
 * 2. **`NULLS LAST` only when the column is nullable.** A plain btree serves
 *    `ASC NULLS LAST` and `DESC NULLS FIRST`; it cannot serve `DESC NULLS
 *    LAST`. Emitting the clause unconditionally on a NOT NULL column is
 *    semantically a no-op that costs the index — measured at 3,294ms vs
 *    15.7ms on app-dev for the same query.
 *
 * The clause shape is asserted directly here because rule 2 is invisible
 * behaviorally on a NOT NULL column: both spellings return identical rows,
 * and only the plan differs.
 */

import { describe, it, expect } from "@jest/globals";
import { PgDialect } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";

import { buildOrderByClause } from "../../../db/repositories/entity-records.repository.js";
import { entityRecords } from "../../../db/schema/entity-records.table.js";

const dialect = new PgDialect();

/** Render a Drizzle SQL fragment to its literal SQL text. */
function render(fragment: ReturnType<typeof buildOrderByClause>): string {
  return dialect.sqlToQuery(fragment).sql;
}

describe("buildOrderByClause (#433)", () => {
  describe("tiebreaker", () => {
    it("appends entity_records.id after a NOT NULL sort column", () => {
      const out = render(buildOrderByClause({ column: entityRecords.created }));
      expect(out).toMatch(/"entity_records"\."id"/);
    });

    it("matches the tiebreaker direction to the sort direction", () => {
      // Mismatched directions cannot be served by one index scan.
      const asc = render(
        buildOrderByClause({ column: entityRecords.created, direction: "asc" })
      );
      const desc = render(
        buildOrderByClause({ column: entityRecords.created, direction: "desc" })
      );
      expect(asc).toMatch(/"created"\s+ASC[\s\S]*"id"\s+ASC/);
      expect(desc).toMatch(/"created"\s+DESC[\s\S]*"id"\s+DESC/);
    });

    it("does not duplicate the clause when already ordering by id", () => {
      const out = render(buildOrderByClause({ column: entityRecords.id }));
      expect(out.match(/"id"/g)).toHaveLength(1);
    });

    it("appends the tiebreaker to a raw SQL sort expression too", () => {
      // Wide-table `c_*` columns arrive as raw SQL via buildSortExpression.
      const out = render(
        buildOrderByClause({ column: sql.raw(`"w"."c_city"`), nullable: true })
      );
      expect(out).toMatch(/"entity_records"\."id"/);
    });
  });

  describe("NULLS LAST", () => {
    it("is omitted for a NOT NULL column", () => {
      // `created`, `synced_at` and `source_id` are all NOT NULL — the clause
      // would be a no-op that defeats the index.
      expect(
        render(buildOrderByClause({ column: entityRecords.created }))
      ).not.toMatch(/NULLS LAST/);
      expect(
        render(buildOrderByClause({ column: entityRecords.syncedAt }))
      ).not.toMatch(/NULLS LAST/);
    });

    it("is omitted for a NOT NULL column sorted descending", () => {
      // The expensive case: `DESC NULLS LAST` is what a plain btree cannot
      // serve, so this is the spelling that must not appear.
      const out = render(
        buildOrderByClause({ column: entityRecords.created, direction: "desc" })
      );
      expect(out).not.toMatch(/NULLS LAST/);
    });

    it("is emitted for a nullable column", () => {
      // `deleted` is nullable on every table via baseColumns.
      expect(
        render(buildOrderByClause({ column: entityRecords.deleted }))
      ).toMatch(/NULLS LAST/);
    });

    it("is emitted for a raw SQL expression declared nullable", () => {
      const out = render(
        buildOrderByClause({ column: sql.raw(`"w"."c_city"`), nullable: true })
      );
      expect(out).toMatch(/NULLS LAST/);
    });

    it("is omitted for a raw SQL expression declared non-nullable", () => {
      const out = render(
        buildOrderByClause({
          column: sql.raw(`"w"."synced_at"`),
          nullable: false,
        })
      );
      expect(out).not.toMatch(/NULLS LAST/);
    });
  });
});

/**
 * The schema-parity pin (#218; the admin-cli #190 pattern — confirmed
 * test-only exception). `tier apply` owns a full-column drizzle def of
 * `tiers`; this test imports the API's REAL table module (pure: drizzle +
 * core only) and asserts the CLI's def is a faithful SUBSET: same table
 * name, and every CLI column exists in the API's with matching db name,
 * dataType and notNull. A migration that changes a converged column turns
 * this red in CI.
 */

import { getTableConfig, type PgTable } from "drizzle-orm/pg-core";

import * as cli from "../tables.js";

// Test-only relative import of the API schema (pure module).
import { tiers as apiTiers } from "../../../../apps/api/src/db/schema/tiers.table.js";

function assertSubset(cliTable: PgTable, apiTable: PgTable): void {
  const c = getTableConfig(cliTable);
  const a = getTableConfig(apiTable);
  expect(c.name).toBe(a.name);
  const apiCols = new Map(a.columns.map((col) => [col.name, col]));
  for (const col of c.columns) {
    const apiCol = apiCols.get(col.name);
    expect(apiCol).toBeDefined();
    expect({
      name: col.name,
      dataType: col.dataType,
      notNull: col.notNull,
    }).toEqual({
      name: apiCol!.name,
      dataType: apiCol!.dataType,
      notNull: apiCol!.notNull,
    });
  }
}

describe("CLI table defs subset-match apps/api's schema (#218)", () => {
  it("tiers (full converge set)", () => assertSubset(cli.tiers, apiTiers));

  it("covers every column tier apply converges", () => {
    const cols = new Set(getTableConfig(cli.tiers).columns.map((c) => c.name));
    for (const required of [
      "slug",
      "display_name",
      "period_kind",
      "period_anchor_day",
      "overage",
      "free_units_per_period",
      "free_rate_per_min",
      "metered_units_per_period",
      "metered_rate_per_min",
      "expensive_units_per_period",
      "expensive_rate_per_min",
      "per_tool_caps",
      "stripe_price_id",
      "selectable",
      "builtin_toolpacks",
      "custom_toolpacks",
    ]) {
      expect(cols).toContain(required);
    }
  });
});

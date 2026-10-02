import { describe, it, expect } from "@jest/globals";

import type { FilterGroup } from "@portalai/core/contracts";
import type { ColumnDataType } from "@portalai/core/models";

import { renderFilterGroupToSql } from "../../utils/filter-sql.util.js";
import type { CachedStatements } from "../../services/wide-table-statement.cache.js";

/**
 * A minimal `CachedStatements` stub — only `columnRefByNormalizedKey` is read
 * by the filter builder. Each column resolves to `"<alias>"."c_<key>"`.
 */
const stmt = {
  columnRefByNormalizedKey: new Map<string, (alias: string) => string>([
    ["region", (a) => `"${a}"."c_region"`],
    ["amount", (a) => `"${a}"."c_amount"`],
    ["status", (a) => `"${a}"."c_status"`],
  ]),
} as unknown as CachedStatements;

const columnTypes: Record<string, ColumnDataType> = {
  region: "string",
  amount: "number",
};

function render(expr: FilterGroup): string {
  const out = renderFilterGroupToSql(expr, stmt, columnTypes);
  if (typeof out !== "string") {
    throw new Error(`unexpected filter error: ${out.message}`);
  }
  return out;
}

describe("renderFilterGroupToSql", () => {
  it("escapes LIKE wildcards so contains / starts_with / ends_with match literally (#678)", () => {
    // `%` and `_` in a user's value were LIKE wildcards: `contains "%"`
    // matched every row.
    const value = String.raw`50%_off\x`;
    const escaped = String.raw`50\%\_off\\x`;
    for (const [operator, pattern] of [
      ["contains", `%${escaped}%`],
      ["not_contains", `%${escaped}%`],
      ["starts_with", `${escaped}%`],
      ["ends_with", `%${escaped}`],
    ] as const) {
      const sql = render({
        combinator: "and",
        conditions: [{ field: "region", operator, value }],
      });
      expect(sql).toContain(`ILIKE '${pattern}' ESCAPE '\\'`);
    }
  });

  it("renders a string equality with the value inlined + quoted", () => {
    const sql = render({
      combinator: "and",
      conditions: [{ field: "region", operator: "eq", value: "NE" }],
    });
    expect(sql).toContain(`"w"."c_region" = 'NE'`);
  });

  it("renders a numeric comparison with the value bare (unquoted)", () => {
    const sql = render({
      combinator: "and",
      conditions: [{ field: "amount", operator: "gt", value: 30 }],
    });
    expect(sql).toContain(`"w"."c_amount" > 30`);
    expect(sql).not.toContain(`'30'`);
  });

  it("combines conditions with AND / OR", () => {
    const sql = render({
      combinator: "or",
      conditions: [
        { field: "region", operator: "eq", value: "NE" },
        { field: "amount", operator: "gte", value: 100 },
      ],
    });
    expect(sql).toMatch(/OR/);
    expect(sql).toContain(`"w"."c_region" = 'NE'`);
    expect(sql).toContain(`"w"."c_amount" >= 100`);
  });

  it("ESCAPES a value containing a quote / SQL — the injection-safety point", () => {
    const attack = `x' OR '1'='1`;
    const sql = render({
      combinator: "and",
      conditions: [{ field: "region", operator: "eq", value: attack }],
    });
    // The single quotes are doubled — the value is a single string literal,
    // never an executable break-out.
    expect(sql).toContain(`'x'' OR ''1''=''1'`);
    // The naive un-escaped break-out must NOT appear.
    expect(sql).not.toContain(`= 'x' OR '1'='1'`);
  });

  it("escapes values in an IN list (enum column)", () => {
    const out = renderFilterGroupToSql(
      {
        combinator: "and",
        conditions: [{ field: "status", operator: "in", value: ["N'E", "SW"] }],
      },
      stmt,
      { status: "enum" }
    );
    if (typeof out !== "string") throw new Error(out.message);
    expect(out).toContain(`'N''E'`);
    expect(out).toContain(`'SW'`);
  });

  it("returns a FilterValidationError for an unknown column", () => {
    const out = renderFilterGroupToSql(
      {
        combinator: "and",
        conditions: [{ field: "nope", operator: "eq", value: 1 }],
      },
      stmt,
      { ...columnTypes, nope: "string" }
    );
    expect(typeof out).not.toBe("string");
    if (typeof out !== "string") expect(out.message).toMatch(/unknown column/i);
  });
});

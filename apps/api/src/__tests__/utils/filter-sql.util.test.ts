import { describe, it, expect } from "@jest/globals";

import type { FilterGroup } from "@portalai/core/contracts";
import type { ColumnDataType } from "@portalai/core/models";

import {
  parseFilterPayload,
  renderFilterGroupToSql,
} from "../../utils/filter-sql.util.js";
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

  it.each(["contains", "not_contains", "starts_with", "ends_with"] as const)(
    "#649: string %s compares the text column directly, with no ::text cast",
    (operator) => {
      // The trigram index is on the bare column; a cast in the predicate
      // shouldn't be what decides whether the planner can use it.
      const sql = render({
        combinator: "and",
        conditions: [{ field: "region", operator, value: "north" }],
      });
      expect(sql).toMatch(/"w"\."c_region" (NOT )?ILIKE /);
      expect(sql).not.toContain("::text");
    }
  );

  it("#649: a column of unknown type keeps the ::text cast", () => {
    const sql = render({
      combinator: "and",
      conditions: [{ field: "status", operator: "contains", value: "open" }],
    });
    expect(sql).toContain(`"w"."c_status"::text ILIKE`);
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

// #805: filters ride the query base64-encoded, so a NUL inside one is
// invisible to the URL check and used to fail in Postgres as a 500.
describe("parseFilterPayload", () => {
  const encode = (expr: unknown) =>
    Buffer.from(JSON.stringify(expr)).toString("base64");
  const columns = [
    { normalizedKey: "region", type: "string" as const },
  ] as unknown as Parameters<typeof parseFilterPayload>[1];

  it("refuses a NUL in a condition value, naming where it is", () => {
    const out = parseFilterPayload(
      encode({
        combinator: "and",
        conditions: [{ field: "region", operator: "eq", value: "we\u0000st" }],
      }),
      columns
    );
    expect(out).toEqual({
      message:
        "Invalid filter: `conditions.0.value` contains a NUL character (U+0000), which can't be stored",
    });
  });

  it("accepts the same filter without the NUL", () => {
    const out = parseFilterPayload(
      encode({
        combinator: "and",
        conditions: [{ field: "region", operator: "eq", value: "west" }],
      }),
      columns
    );
    expect(out).not.toHaveProperty("message");
  });
});

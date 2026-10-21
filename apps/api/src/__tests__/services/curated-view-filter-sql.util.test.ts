/**
 * #644: the advanced curated-view SQL filter gate. `validateViewFilterSql` is
 * the static security boundary for a stored fragment (the reader role is the
 * backstop), and `renderViewFilterSql` splices its column keys into the wide
 * table's physical names. These pin what is accepted, what is refused (and
 * that the refusal names the construct), and that the splice is exact across
 * multibyte text, quoted identifiers and comments.
 */
import { describe, it, expect } from "@jest/globals";

import {
  validateViewFilterSql,
  renderViewFilterSql,
  FILTER_SQL_ALLOWED_OPERATORS,
  FILTER_SQL_ALLOWED_CAST_TYPES,
  FILTER_SQL_MAX_NODES,
} from "../../services/curated-view-filter-sql.util.js";
import {
  PORTAL_SQL_ALLOWED_FUNCTIONS,
  POSTGIS_ALLOWED_FUNCTIONS,
} from "../../services/portal-sql-parse.util.js";
import { ApiError } from "../../services/http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

const KEYS = new Set([
  "amount",
  "cost",
  "name",
  "city",
  "status",
  "flag",
  "payload",
  "location",
  "created_on",
  "order",
  "a",
  "ab",
]);

const COLUMNS = new Map([...KEYS].map((k) => [k, `c_${k}`]));

function refusal(sql: string): ApiError {
  try {
    validateViewFilterSql(sql, KEYS);
  } catch (err) {
    expect(err).toBeInstanceOf(ApiError);
    return err as ApiError;
  }
  throw new Error(`expected a refusal for: ${sql}`);
}

function expectRefused(sql: string, message: RegExp): void {
  const err = refusal(sql);
  expect(err.status).toBe(400);
  expect(err.code).toBe(ApiCode.CURATED_VIEW_INVALID_FILTER_SQL);
  expect(err.message).toMatch(message);
}

describe("validateViewFilterSql — accepts (#644)", () => {
  it.each([
    ["comparison and column-vs-column", "amount > cost", ["amount", "cost"]],
    [
      "nested AND / OR / NOT",
      "amount > 10 AND (status = 'a' OR NOT name IS NULL)",
      ["amount", "name", "status"],
    ],
    ["IN list", "status IN ('a', 'b')", ["status"]],
    ["BETWEEN", "amount BETWEEN 1 AND 5", ["amount"]],
    ["LIKE and ILIKE", "name LIKE 'a%' OR city ILIKE '%x%'", ["city", "name"]],
    ["regex", "name ~ '^a' OR city ~* 'x$'", ["city", "name"]],
    [
      "IS NULL / IS TRUE",
      "status IS NULL AND flag IS TRUE",
      ["flag", "status"],
    ],
    ["IS DISTINCT FROM", "status IS DISTINCT FROM 'x'", ["status"]],
    [
      "JSON operators",
      `payload->>'status' = 'active' AND payload ? 'k' AND payload @> '{"a":1}'::jsonb AND payload #>> '{a,b}' = 'x'`,
      ["payload"],
    ],
    [
      "ST_DWithin on geometry",
      "ST_DWithin(location, ST_SetSRID(ST_MakePoint(-71.1, 42.3), 4326), 0.1)",
      ["location"],
    ],
    [
      "geography cast for metres",
      "ST_DWithin(location::geography, ST_MakePoint(1, 2)::geography, 8046.72)",
      ["location"],
    ],
    [
      "CASE / COALESCE / NULLIF / GREATEST",
      "CASE WHEN flag THEN amount ELSE cost END > COALESCE(NULLIF(amount, 0), GREATEST(cost, 1))",
      ["amount", "cost", "flag"],
    ],
    [
      "casts",
      "amount::numeric > 1 AND created_on::date > '2024-01-01' AND cost::double precision < 2.5",
      ["amount", "cost", "created_on"],
    ],
    ["= ANY(ARRAY[…])", "status = ANY(ARRAY['a', 'b'])", ["status"]],
    [
      "quoted identifiers, incl. a reserved word",
      `"amount" > 1 AND "order" = 2`,
      ["amount", "order"],
    ],
    ["unquoted upper case folds to the key", "AMOUNT > 1", ["amount"]],
    [
      "a trailing comment can't swallow the fence",
      "amount > 1 -- ) OR (TRUE",
      ["amount"],
    ],
    ["a block comment", "/* only big ones */ amount > 1", ["amount"]],
  ])("%s", (_label, sql, keys) => {
    expect(validateViewFilterSql(sql, KEYS).keys).toEqual(keys);
  });
});

describe("validateViewFilterSql — refuses (#644)", () => {
  it.each([
    [
      "escaping its parentheses with OR",
      "amount > 1) OR (TRUE",
      /single condition/,
    ],
    [
      "escaping its parentheses with AND",
      "amount > 1) AND (TRUE",
      /single condition/,
    ],
    [
      "a second statement",
      "amount > 1); DROP TABLE organizations; --",
      /syntax error|exactly one statement/,
    ],
    ["EXISTS sub-select", "EXISTS (SELECT 1 FROM organizations)", /subquer/],
    ["IN sub-select", "amount IN (SELECT 1)", /subquer/],
    [
      "another table's column",
      "er__x.c_a = 1",
      /column reference not allowed: er__x\.c_a/,
    ],
    [
      "a qualified column",
      "organizations.id = 'x'",
      /column reference not allowed/,
    ],
    [
      "the wide-table alias",
      "w.c_amount > 1",
      /column reference not allowed: w\.c_amount/,
    ],
    ["an unknown column", "salary > 1", /unknown column: salary/],
    [
      "a schema-qualified function",
      "pg_catalog.lower(name) = 'x'",
      /schema-qualified function/,
    ],
    ["pg_sleep", "pg_sleep(10) IS NULL", /function not allowed: pg_sleep/],
    [
      "set_config",
      "set_config('a', 'b', false) = 'b'",
      /function not allowed: set_config/,
    ],
    [
      "query_to_xml",
      "query_to_xml('select 1', true, true, '') IS NULL",
      /function not allowed: query_to_xml/,
    ],
    [
      "current_setting",
      "current_setting('x') = 'y'",
      /function not allowed: current_setting/,
    ],
    [
      "lo_import",
      "lo_import('/etc/passwd') = 1",
      /function not allowed: lo_import/,
    ],
    ["dblink", "dblink('x', 'y') IS NULL", /function not allowed: dblink/],
    ["an aggregate", "count(amount) > 1", /aggregate/],
    ["a window function", "row_number() OVER () > 1", /window/],
    ["a set-returning function", "unnest(ARRAY[1]) = 1", /set-returning/],
    ["a parameter", "amount = $1", /not allowed: ParamRef/],
    [
      "subscripts / field selection",
      "payload[1] = 1",
      /not allowed: A_Indirection/,
    ],
    ["COLLATE", `name COLLATE "C" = 'x'`, /not allowed: CollateClause/],
    ["current_user", "current_user = 'x'", /not allowed: SQLValueFunction/],
    [
      "a row constructor",
      "ROW(amount, cost) = ROW(1, 2)",
      /not allowed: RowExpr/,
    ],
    [
      "a disallowed cast",
      "amount::regclass IS NULL",
      /cast not allowed: regclass/,
    ],
    [
      "a schema-qualified cast",
      "location::public.geometry IS NULL",
      /cast not allowed: public\.geometry/,
    ],
    [
      "a qualified operator",
      "amount OPERATOR(pg_catalog.+) 1 > 1",
      /operator not allowed/,
    ],
    ["a disallowed operator", "name !~~ 'x'", /operator not allowed: !~~/],
    ["SIMILAR TO", "name SIMILAR TO 'a%'", /not allowed/],
    [
      "a unicode-escaped identifier",
      `U&"amount" > 1`,
      /unicode-escaped identifiers/,
    ],
    ["an unterminated comment", "amount > 1 /*", /syntax error/],
    ["not SQL at all", "this is not sql", /syntax error/],
    ["an empty filter", "   ", /empty/],
  ])("%s", (_label, sql, message) => {
    expectRefused(sql, message);
  });

  it("refuses a filter over the length limit", () => {
    expectRefused(`amount > ${"1".repeat(4001)}`, /at most 4000 characters/);
  });

  it("refuses a filter over the node limit", () => {
    const sql = Array.from({ length: 80 }, () => "amount = 1").join(" OR ");
    expectRefused(sql, new RegExp(`at most ${FILTER_SQL_MAX_NODES} nodes`));
  });

  it("reports the refused construct's character position in the fragment", () => {
    // `salary` sits after a 4-byte emoji: Postgres reports a byte offset into
    // the wrapped statement, the editor needs a string index into the fragment.
    const err = refusal("name = '😀' AND salary > 1");
    expect(err.message).toMatch(/unknown column: salary/);
    expect(err.details).toEqual({ position: 16 });
  });
});

describe("renderViewFilterSql — splice (#644)", () => {
  it.each([
    ["column vs column", "amount > cost", `w."c_amount" > w."c_cost"`],
    [
      "refs after multibyte text",
      "name = 'é😀' AND city = 'x'",
      `w."c_name" = 'é😀' AND w."c_city" = 'x'`,
    ],
    ["a key that prefixes another key", "ab > a", `w."c_ab" > w."c_a"`],
    ["a quoted key", `"amount" > 1`, `w."c_amount" > 1`],
    ["an upper-case key", "AMOUNT > 1", `w."c_amount" > 1`],
    [
      "inside a JSON operator",
      "payload->>'k' = 'v'",
      `w."c_payload"->>'k' = 'v'`,
    ],
    [
      "inside a PostGIS call",
      "ST_DWithin(location, ST_MakePoint(1, 2), 0.5)",
      `ST_DWithin(w."c_location", ST_MakePoint(1, 2), 0.5)`,
    ],
    [
      "a repeated ref",
      "amount > 1 AND amount < 5",
      `w."c_amount" > 1 AND w."c_amount" < 5`,
    ],
    [
      "a comment-adjacent line",
      "amount > 1 -- the big ones\nAND cost < 2",
      `w."c_amount" > 1 -- the big ones\nAND w."c_cost" < 2`,
    ],
  ])("%s", (_label, sql, rendered) => {
    expect(renderViewFilterSql(sql, COLUMNS)).toBe(rendered);
  });

  it("renders a filter at the length limit (the limit is the author's text)", () => {
    const prefix = "amount > cost AND cost > amount AND name = '";
    const sql = prefix + "x".repeat(4000 - prefix.length - 1) + "'";
    expect(sql).toHaveLength(4000);
    expect(validateViewFilterSql(sql, KEYS).keys).toEqual([
      "amount",
      "cost",
      "name",
    ]);
    expect(renderViewFilterSql(sql, COLUMNS)).toContain(`w."c_amount"`);
  });

  it("renders a filter at the node limit (rendering adds a node per reference)", () => {
    let n = 60;
    const chain = (k: number) =>
      Array.from({ length: k }, () => "amount = cost").join(" OR ");
    const fits = (k: number) => {
      try {
        validateViewFilterSql(chain(k), KEYS);
        return true;
      } catch {
        return false;
      }
    };
    while (!fits(n)) n -= 1;
    expect(n).toBeGreaterThan(10);
    expect(() => renderViewFilterSql(chain(n), COLUMNS)).not.toThrow();
  });

  it("quotes a physical column name carrying a double quote", () => {
    const columns = new Map([["amount", `c_we"ird`]]);
    expect(renderViewFilterSql("amount > 1", columns)).toBe(
      `w."c_we""ird" > 1`
    );
  });

  it("fails closed when a referenced column no longer exists", () => {
    const columns = new Map([["cost", "c_cost"]]);
    expect(() => renderViewFilterSql("amount > cost", columns)).toThrow(
      expect.objectContaining({
        status: 500,
        code: ApiCode.CURATED_VIEW_FILTER_SQL_BROKEN,
      })
    );
  });

  it("fails closed on a stored fragment that no longer validates", () => {
    expect(() => renderViewFilterSql("amount > 1) OR (TRUE", COLUMNS)).toThrow(
      expect.objectContaining({ code: ApiCode.CURATED_VIEW_FILTER_SQL_BROKEN })
    );
  });
});

describe("filter SQL allow-lists — audit (#644)", () => {
  // Functions that read relations by name, reveal server state, change
  // settings or reach outside the database. None may ever be callable from a
  // stored filter, whatever is later added to the shared agent allow-lists.
  const PRIVILEGED = [
    "query_to_xml",
    "table_to_xml",
    "cursor_to_xml",
    "has_table_privilege",
    "has_column_privilege",
    "has_schema_privilege",
    "to_regclass",
    "currval",
    "nextval",
    "setval",
    "lastval",
    "pg_read_file",
    "pg_read_binary_file",
    "pg_ls_dir",
    "pg_sleep",
    "lo_import",
    "lo_export",
    "lo_get",
    "dblink",
    "dblink_exec",
    "set_config",
    "current_setting",
    "pg_terminate_backend",
    "pg_cancel_backend",
    "txid_current",
  ];

  it("allows none of the privileged or relation-taking functions", () => {
    const allowed = new Set([
      ...PORTAL_SQL_ALLOWED_FUNCTIONS,
      ...POSTGIS_ALLOWED_FUNCTIONS,
    ]);
    expect(PRIVILEGED.filter((fn) => allowed.has(fn))).toEqual([]);
    for (const fn of PRIVILEGED) {
      expectRefused(`${fn}('x') IS NULL`, /function not allowed/);
    }
  });

  it("allows only comparison, pattern, arithmetic, JSON and spatial operators", () => {
    expect([...FILTER_SQL_ALLOWED_OPERATORS].sort()).toEqual(
      [
        "=",
        "<>",
        "!=",
        "<",
        "<=",
        ">",
        ">=",
        "+",
        "-",
        "*",
        "/",
        "%",
        "||",
        "~",
        "~*",
        "!~",
        "!~*",
        "->",
        "->>",
        "#>",
        "#>>",
        "@>",
        "<@",
        "?",
        "?|",
        "?&",
        "&&",
        "<->",
      ].sort()
    );
    expect(FILTER_SQL_ALLOWED_CAST_TYPES.has("regclass")).toBe(false);
    expect(FILTER_SQL_ALLOWED_CAST_TYPES.has("oid")).toBe(false);
  });
});

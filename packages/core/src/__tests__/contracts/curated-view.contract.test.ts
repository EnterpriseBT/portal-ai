import { describe, it, expect } from "@jest/globals";

import {
  CuratedViewCreateRequestBodySchema,
  CuratedViewUpdateRequestBodySchema,
  FILTER_SQL_MAX_LENGTH,
  CuratedViewGetResponsePayloadSchema,
  CuratedViewListItemSchema,
  CuratedViewRecordsRequestQuerySchema,
  CuratedViewRecordsResponsePayloadSchema,
} from "../../contracts/curated-view.contract.js";

const column = {
  key: "email",
  label: "Email",
  type: "string",
  normalizedKey: "email",
  required: false,
  enumValues: null,
  defaultValue: null,
  format: null,
  validationPattern: null,
  canonicalFormat: null,
};

const page = (columns: unknown[]) => ({
  columns,
  records: [{ _record_id: "r1", _source_id: "s1", email: "a@b.co" }],
  total: 1,
  limit: 10,
  offset: 0,
});

describe("curated-view records contract (#678)", () => {
  it("accepts the standard pagination query", () => {
    expect(
      CuratedViewRecordsRequestQuerySchema.safeParse({ limit: "10" }).success
    ).toBe(true);
  });

  it("accepts an optional base64 `filters` string (the entity list's format)", () => {
    const parsed = CuratedViewRecordsRequestQuerySchema.safeParse({
      limit: "10",
      filters: "eyJjb21iaW5hdG9yIjoiYW5kIiwiY29uZGl0aW9ucyI6W119",
    });
    expect(parsed.success && parsed.data.filters).toBe(
      "eyJjb21iaW5hdG9yIjoiYW5kIiwiY29uZGl0aW9ucyI6W119"
    );
  });

  it("returns the projected columns as ResolvedColumns", () => {
    expect(
      CuratedViewRecordsResponsePayloadSchema.safeParse(page([column])).success
    ).toBe(true);
  });

  it("rejects the old { key, label }-only column shape", () => {
    expect(
      CuratedViewRecordsResponsePayloadSchema.safeParse(
        page([{ key: "c_email", label: "Email" }])
      ).success
    ).toBe(false);
  });
});

// #680: a reader gets `filter: null` and whether the view is filtered or
// projected, not the definition.
const viewRow = {
  id: "v1",
  organizationId: "o1",
  connectorEntityId: "e1",
  key: "v",
  label: "V",
  description: null,
  filter: null,
  filterSql: null,
  filterSqlKeys: [],
  created: 1,
  createdBy: "u1",
  updated: null,
  updatedBy: null,
  deleted: null,
  deletedBy: null,
};

describe("curated-view get / list contract (#680)", () => {
  it("a view carries `filtered` and `projected` booleans", () => {
    expect(
      CuratedViewGetResponsePayloadSchema.safeParse({
        curatedView: {
          ...viewRow,
          fieldMappingIds: [],
          filtered: true,
          projected: false,
          capabilities: {
            read: true,
            write: false,
            delete: false,
            share: false,
          },
        },
      }).success
    ).toBe(true);
    expect(
      CuratedViewListItemSchema.safeParse({
        ...viewRow,
        entity: null,
        filtered: true,
        projected: true,
      }).success
    ).toBe(true);
  });

  it("requires them", () => {
    expect(
      CuratedViewGetResponsePayloadSchema.safeParse({
        curatedView: { ...viewRow, fieldMappingIds: [] },
      }).success
    ).toBe(false);
    expect(
      CuratedViewListItemSchema.safeParse({ ...viewRow, entity: null }).success
    ).toBe(false);
  });
});

describe("curated-view SQL filter request bodies (#644)", () => {
  const create = {
    connectorEntityId: "e1",
    key: "near_parcels",
    label: "Near parcels",
  };
  const group = {
    combinator: "and" as const,
    conditions: [{ field: "name", operator: "eq" as const, value: "x" }],
  };
  const issue = (
    schema:
      | typeof CuratedViewCreateRequestBodySchema
      | typeof CuratedViewUpdateRequestBodySchema,
    body: unknown
  ) => {
    const parsed = schema.safeParse(body);
    return parsed.success ? null : parsed.error.issues[0];
  };

  it("accepts a SQL filter on create and on update, trimmed", () => {
    const parsed = CuratedViewCreateRequestBodySchema.parse({
      ...create,
      filterSql: "  amount > cost \n",
    });
    expect(parsed.filterSql).toBe("amount > cost");
    expect(
      CuratedViewUpdateRequestBodySchema.parse({ filterSql: "amount > 1" })
        .filterSql
    ).toBe("amount > 1");
  });

  it("accepts null to clear the SQL filter", () => {
    expect(
      CuratedViewUpdateRequestBodySchema.parse({ filterSql: null }).filterSql
    ).toBeNull();
  });

  it("refuses an empty SQL filter", () => {
    expect(
      issue(CuratedViewCreateRequestBodySchema, { ...create, filterSql: "  " })
    ).toMatchObject({ path: ["filterSql"], message: "Filter is required" });
  });

  it("refuses a SQL filter over the length limit", () => {
    expect(
      issue(CuratedViewUpdateRequestBodySchema, {
        filterSql: "a".repeat(FILTER_SQL_MAX_LENGTH + 1),
      })
    ).toMatchObject({
      path: ["filterSql"],
      message: `Filter must be at most ${FILTER_SQL_MAX_LENGTH} characters`,
    });
    expect(
      issue(CuratedViewUpdateRequestBodySchema, {
        filterSql: "a".repeat(FILTER_SQL_MAX_LENGTH),
      })
    ).toBeNull();
  });

  const bothModes = {
    path: ["filterSql"],
    message: "Use either the builder filter or a SQL filter, not both",
  };

  it("refuses both filter modes at once on create", () => {
    expect(
      issue(CuratedViewCreateRequestBodySchema, {
        ...create,
        filter: group,
        filterSql: "amount > 1",
      })
    ).toMatchObject(bothModes);
  });

  it("refuses both filter modes at once on update", () => {
    expect(
      issue(CuratedViewUpdateRequestBodySchema, {
        filter: group,
        filterSql: "amount > 1",
      })
    ).toMatchObject(bothModes);
  });

  it("allows one mode set and the other cleared in the same body", () => {
    expect(
      issue(CuratedViewUpdateRequestBodySchema, {
        filter: null,
        filterSql: "amount > 1",
      })
    ).toBeNull();
    expect(
      issue(CuratedViewUpdateRequestBodySchema, {
        filter: group,
        filterSql: null,
      })
    ).toBeNull();
  });

  it("still refuses an unknown key", () => {
    expect(
      issue(CuratedViewUpdateRequestBodySchema, { filterSqlKeys: ["a"] })
    ).toMatchObject({ code: "unrecognized_keys" });
  });
});

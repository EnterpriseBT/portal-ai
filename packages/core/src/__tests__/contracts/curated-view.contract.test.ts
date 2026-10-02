import { describe, it, expect } from "@jest/globals";

import {
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

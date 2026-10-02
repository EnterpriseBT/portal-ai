import { describe, it, expect } from "@jest/globals";

import {
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

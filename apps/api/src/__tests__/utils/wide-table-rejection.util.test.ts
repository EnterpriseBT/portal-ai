import { describe, it, expect } from "@jest/globals";

import { ApiCode } from "../../constants/api-codes.constants.js";
import { ApiError } from "../../services/http.service.js";
import {
  assertNoRejectedGeometry,
  MAX_ECHOED_REJECTIONS,
  MAX_ECHOED_SOURCE_ID_LENGTH,
} from "../../utils/wide-table-rejection.util.js";
import type { WideTableRejection } from "../../db/repositories/wide-table.repository.js";

const rejection = (
  sourceId: string,
  over: Partial<WideTableRejection> = {}
): WideTableRejection => ({
  sourceId,
  code: ApiCode.GEOMETRY_INVALID_ON_IMPORT,
  fields: ["geom"],
  problems: [{ code: ApiCode.GEOMETRY_INVALID_ON_IMPORT, fields: ["geom"] }],
  reason: "GEOMETRY_INVALID_ON_IMPORT: geometry was unparseable",
  ...over,
});

const thrown = (fn: () => void): ApiError => {
  try {
    fn();
  } catch (e) {
    return e as ApiError;
  }
  throw new Error("expected a throw");
};

describe("assertNoRejectedGeometry (#757)", () => {
  it("passes when nothing was rejected", () => {
    expect(() => assertNoRejectedGeometry({ rejected: [] })).not.toThrow();
  });

  it("a single write answers 400 naming the field", () => {
    const err = thrown(() =>
      assertNoRejectedGeometry({ rejected: [rejection("r-1")] })
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err.status).toBe(400);
    expect(err.code).toBe(ApiCode.GEOMETRY_INVALID_ON_IMPORT);
    expect(err.message).toBe(
      'Field "geom" is not a geometry that can be stored (expected a GeoJSON geometry object or null)'
    );
    expect(err.details).toEqual({
      rejected: [
        {
          sourceId: "r-1",
          code: ApiCode.GEOMETRY_INVALID_ON_IMPORT,
          fields: ["geom"],
        },
      ],
      rejectedCount: 1,
    });
  });

  it("an unsupported SRID keeps its own code", () => {
    const err = thrown(() =>
      assertNoRejectedGeometry({
        rejected: [
          rejection("r-1", {
            code: ApiCode.GIS_SRID_UNSUPPORTED,
            problems: [
              { code: ApiCode.GIS_SRID_UNSUPPORTED, fields: ["geom"] },
            ],
          }),
        ],
      })
    );
    expect(err.code).toBe(ApiCode.GIS_SRID_UNSUPPORTED);
    expect(err.message).toMatch(/coordinate system/);
  });

  it("a batch names the refused sourceIds, capped, with the total", () => {
    const many = Array.from({ length: MAX_ECHOED_REJECTIONS + 5 }, (_, i) =>
      rejection(`s-${i}`)
    );
    const err = thrown(() =>
      assertNoRejectedGeometry({ rejected: many }, { batch: true })
    );
    expect(err.message).toMatch(
      /^25 records carry a geometry that can't be written; nothing was written: "s-0", "s-1",/
    );
    expect(err.message).toMatch(/ and 5 more\. Field "geom" is not/);
    expect((err.details!.rejected as unknown[]).length).toBe(
      MAX_ECHOED_REJECTIONS
    );
    expect(err.details!.rejectedCount).toBe(MAX_ECHOED_REJECTIONS + 5);
  });

  it("a long sourceId is clipped in the echo", () => {
    const long = "x".repeat(MAX_ECHOED_SOURCE_ID_LENGTH * 100);
    const err = thrown(() =>
      assertNoRejectedGeometry({ rejected: [rejection(long)] }, { batch: true })
    );
    expect(err.message.length).toBeLessThan(400);
    const echoed = (err.details!.rejected as Array<{ sourceId: string }>)[0];
    expect(echoed.sourceId).toBe(`${"x".repeat(MAX_ECHOED_SOURCE_ID_LENGTH)}…`);
  });

  it("names several fields in the plural", () => {
    const err = thrown(() =>
      assertNoRejectedGeometry({
        rejected: [
          rejection("r-1", {
            fields: ["a", "b"],
            problems: [
              { code: ApiCode.GEOMETRY_INVALID_ON_IMPORT, fields: ["a", "b"] },
            ],
          }),
        ],
      })
    );
    expect(err.message).toBe(
      'Fields "a", "b" are not geometries that can be stored (expected a GeoJSON geometry object or null)'
    );
  });

  it("names every problem on the row, SRID first", () => {
    const err = thrown(() =>
      assertNoRejectedGeometry({
        rejected: [
          rejection("r-1", {
            code: ApiCode.GIS_SRID_UNSUPPORTED,
            fields: ["a", "b"],
            problems: [
              { code: ApiCode.GIS_SRID_UNSUPPORTED, fields: ["a"] },
              { code: ApiCode.GEOMETRY_INVALID_ON_IMPORT, fields: ["b"] },
            ],
          }),
        ],
      })
    );
    expect(err.code).toBe(ApiCode.GIS_SRID_UNSUPPORTED);
    expect(err.message).toBe(
      'Field "a" uses a coordinate system (SRID) that isn\'t supported; field "b" is not a geometry that can be stored (expected a GeoJSON geometry object or null)'
    );
  });

  it("a batch can name rows by the caller's own label", () => {
    const err = thrown(() =>
      assertNoRejectedGeometry(
        { rejected: [rejection("uuid-1"), rejection("uuid-2")] },
        {
          batch: true,
          describe: (id) => (id === "uuid-1" ? "items[0]" : "items[3]"),
        }
      )
    );
    expect(err.message).toMatch(
      /nothing was written: items\[0\], items\[3\]\./
    );
    expect(err.message).not.toMatch(/uuid/);
  });
});

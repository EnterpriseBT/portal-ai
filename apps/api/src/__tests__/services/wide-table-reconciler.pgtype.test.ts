import { describe, it, expect } from "@jest/globals";
import type { ColumnDataType } from "@portalai/core/models";

import { pgTypeForColumnDefinitionType } from "../../services/wide-table-reconciler.service.js";

describe("pgTypeForColumnDefinitionType", () => {
  // #316: geometry maps to a typed, SRID-constrained PostGIS column.
  // `Geometry` (not `Polygon`) because one column may hold mixed
  // polygon/point/line features; the SRID constraint is the part that
  // matters and is what makes the GiST index and ST_* calls correct.
  it("maps geometry to geometry(Geometry, 4326)", () => {
    expect(pgTypeForColumnDefinitionType("geometry")).toBe(
      "geometry(Geometry, 4326)"
    );
  });

  it.each([
    ["string", "text"],
    ["enum", "text"],
    ["reference", "text"],
    ["number", "numeric"],
    ["boolean", "boolean"],
    ["date", "date"],
    ["datetime", "timestamptz"],
    ["reference-array", "text[]"],
    ["array", "jsonb"],
    ["json", "jsonb"],
  ] as [ColumnDataType, string][])(
    "maps %s to %s (unchanged by #316)",
    (type, expected) => {
      expect(pgTypeForColumnDefinitionType(type)).toBe(expected);
    }
  );
});

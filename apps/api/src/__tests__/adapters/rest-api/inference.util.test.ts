import { describe, it, expect } from "@jest/globals";

import {
  inferColumns,
  MAX_SAMPLES_PER_COLUMN,
} from "../../../adapters/rest-api/inference.util.js";

// ── Empty / degenerate inputs ────────────────────────────────────────

describe("inferColumns — empty / degenerate inputs", () => {
  it("returns no columns and no samples on an empty array", () => {
    expect(inferColumns([])).toEqual({ columns: [], samples: {} });
  });

  it("treats a non-object array as a single `value` column of type json", () => {
    const records = ["a", "b", "c"];
    const result = inferColumns(records);
    expect(result.columns).toEqual([
      { key: "value", label: "Value", type: "json", required: false },
    ]);
    expect(result.samples).toEqual({ value: ["a", "b", "c"] });
  });

  it("caps samples at MAX_SAMPLES_PER_COLUMN for primitive-record fallback", () => {
    const records = ["a", "b", "c", "d", "e", "f", "g"];
    const result = inferColumns(records);
    expect(result.samples.value).toHaveLength(MAX_SAMPLES_PER_COLUMN);
  });
});

// ── Type inference truth table ───────────────────────────────────────

describe("inferColumns — single-record + scalar types", () => {
  it("infers string + required for a single-record string field", () => {
    const result = inferColumns([{ name: "Alice" }]);
    expect(result.columns).toEqual([
      { key: "name", label: "name", type: "string", required: true },
    ]);
    expect(result.samples).toEqual({ name: ["Alice"] });
  });

  it("infers number, boolean, json from single-record scalars + nested", () => {
    const result = inferColumns([{ age: 30, active: true, meta: { x: 1 } }]);
    const byKey = Object.fromEntries(result.columns.map((c) => [c.key, c]));
    expect(byKey.age.type).toBe("number");
    expect(byKey.active.type).toBe("boolean");
    expect(byKey.meta.type).toBe("json");
  });
});

describe("inferColumns — multi-record scalar collapse", () => {
  it("infers number when every record has a number value", () => {
    const records = Array.from({ length: 10 }, (_, i) => ({ age: i }));
    const result = inferColumns(records);
    expect(result.columns).toEqual([
      { key: "age", label: "age", type: "number", required: true },
    ]);
  });

  it("collapses mixed scalars to string (9 number + 1 string → string)", () => {
    const records = [
      ...Array.from({ length: 9 }, (_, i) => ({ age: i })),
      { age: "ten" },
    ];
    const result = inferColumns(records);
    expect(result.columns[0]).toMatchObject({ key: "age", type: "string" });
  });

  it("marks required: false when at least one record is missing the key", () => {
    const records = [
      ...Array.from({ length: 9 }, (_, i) => ({ age: i })),
      { name: "no-age" },
    ];
    const result = inferColumns(records);
    const ageCol = result.columns.find((c) => c.key === "age")!;
    expect(ageCol.type).toBe("number");
    expect(ageCol.required).toBe(false);
  });
});

describe("inferColumns — nested + array values", () => {
  it("infers json for an array-typed field", () => {
    const records = Array.from({ length: 10 }, () => ({ tags: ["x", "y"] }));
    const result = inferColumns(records);
    expect(result.columns).toEqual([
      { key: "tags", label: "tags", type: "json", required: true },
    ]);
    expect(result.samples.tags?.[0]).toEqual(["x", "y"]);
  });

  it("infers json for an object-typed field", () => {
    const records = Array.from({ length: 10 }, () => ({
      meta: { region: "us" },
    }));
    const result = inferColumns(records);
    expect(result.columns[0]).toMatchObject({ key: "meta", type: "json" });
  });

  it("collapses scalar+object to json", () => {
    const records = [{ meta: { a: 1 } }, { meta: "huh" }, { meta: { b: 2 } }];
    const result = inferColumns(records);
    expect(result.columns[0]).toMatchObject({ key: "meta", type: "json" });
  });
});

describe("inferColumns — required flag + nulls", () => {
  it("treats a record with explicit null on the key as 'present but null'", () => {
    // Decision: missing keys make required=false, but explicit null still
    // marks the key as observed. The required flag is true iff every
    // record carries a non-null value for the key.
    const records = [
      { id: "a", note: null },
      { id: "b", note: "x" },
      { id: "c", note: "y" },
    ];
    const result = inferColumns(records);
    const byKey = Object.fromEntries(result.columns.map((c) => [c.key, c]));
    expect(byKey.id.required).toBe(true);
    expect(byKey.note.required).toBe(false);
    expect(byKey.note.type).toBe("string");
  });

  it("defaults all-null fields to string with required: false", () => {
    const records = Array.from({ length: 5 }, () => ({ note: null }));
    const result = inferColumns(records);
    expect(result.columns[0]).toEqual({
      key: "note",
      label: "note",
      type: "string",
      required: false,
    });
  });

  it("unions keys across heterogeneous records", () => {
    const records = [
      ...Array.from({ length: 10 }, () => ({ value: "x" })),
      ...Array.from({ length: 10 }, () => ({ other: "y" })),
    ];
    const result = inferColumns(records);
    const keys = result.columns.map((c) => c.key).sort();
    expect(keys).toEqual(["other", "value"]);
    expect(result.columns.every((c) => c.required === false)).toBe(true);
  });
});

// ── Sample collection ────────────────────────────────────────────────

describe("inferColumns — sample collection", () => {
  it("caps the sample list at MAX_SAMPLES_PER_COLUMN distinct values", () => {
    const records = Array.from({ length: 20 }, (_, i) => ({
      x: `value-${i}`,
    }));
    const result = inferColumns(records);
    expect(result.samples.x).toHaveLength(MAX_SAMPLES_PER_COLUMN);
  });

  it("dedupes sample values, preserving insertion order", () => {
    const records = [
      { x: "a" },
      { x: "a" },
      { x: "b" },
      { x: "a" },
      { x: "c" },
    ];
    const result = inferColumns(records);
    expect(result.samples.x).toEqual(["a", "b", "c"]);
  });

  it("excludes nulls from the sample list", () => {
    const records = [{ note: "x" }, { note: null }, { note: "y" }];
    const result = inferColumns(records);
    expect(result.samples.note).toEqual(["x", "y"]);
  });

  it("processes the entire input — the caller is responsible for slicing to 25", () => {
    // Inference util doesn't impose its own slice; that's the adapter's job.
    const records = Array.from({ length: 100 }, (_, i) => ({ x: i }));
    const result = inferColumns(records);
    expect(result.columns[0]).toMatchObject({ type: "number" });
    // Required, because all 100 have the key.
    expect(result.columns[0].required).toBe(true);
  });
});

describe("inferColumns — geospatial (#316)", () => {
  it("infers `geometry` for a column of ArcGIS ring objects", () => {
    const records = [
      {
        boundary: {
          rings: [
            [
              [0, 0],
              [0, 1],
              [1, 1],
              [0, 0],
            ],
          ],
        },
      },
      {
        boundary: {
          rings: [
            [
              [2, 2],
              [2, 3],
              [3, 3],
              [2, 2],
            ],
          ],
        },
      },
    ];
    const col = inferColumns(records).columns.find((c) => c.key === "boundary");
    expect(col?.type).toBe("geometry");
    // geometry is a type, not a role.
    expect(col?.geoRole ?? null).toBeNull();
  });

  it("infers `geometry` for a column of GeoJSON geometry objects", () => {
    const records = [
      { geom: { type: "Point", coordinates: [1, 2] } },
      { geom: { type: "Point", coordinates: [3, 4] } },
    ];
    const col = inferColumns(records).columns.find((c) => c.key === "geom");
    expect(col?.type).toBe("geometry");
  });

  it("keeps a non-geometry object column as json", () => {
    const records = [{ meta: { a: 1 } }, { meta: { b: 2 } }];
    const col = inferColumns(records).columns.find((c) => c.key === "meta");
    expect(col?.type).toBe("json");
  });

  it("tags a numeric lat/lng column with a coordinate role", () => {
    const records = [
      { latitude: 40.7, longitude: -74.0 },
      { latitude: 34.0, longitude: -118.2 },
    ];
    const cols = inferColumns(records).columns;
    expect(cols.find((c) => c.key === "latitude")).toMatchObject({
      type: "number",
      geoRole: "lat",
    });
    expect(cols.find((c) => c.key === "longitude")).toMatchObject({
      type: "number",
      geoRole: "lng",
    });
  });

  it("does NOT tag an out-of-range numeric named like a coordinate", () => {
    // "latency" isn't a coordinate name, and 4200 is out of lat range anyway.
    const records = [{ lat: 4200 }, { lat: 9001 }];
    const col = inferColumns(records).columns.find((c) => c.key === "lat");
    expect(col?.type).toBe("number");
    expect(col?.geoRole ?? null).toBeNull();
  });
});

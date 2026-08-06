import { describe, it, expect } from "@jest/globals";

import {
  toGeoJsonCandidate,
  looksLikeGeometry,
  extractSourceSrid,
  stampEsriSpatialReference,
} from "../../../adapters/rest-api/geometry.util.js";

describe("toGeoJsonCandidate", () => {
  it("translates ArcGIS rings → GeoJSON Polygon (coordinates = rings)", () => {
    const rings = [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [0, 0],
      ],
    ];
    expect(
      toGeoJsonCandidate({ rings, spatialReference: { wkid: 102100 } })
    ).toEqual({ type: "Polygon", coordinates: rings });
  });

  it("groups disjoint Esri rings (islands) into a MultiPolygon, not a holed Polygon (#316)", () => {
    // Two separate clockwise (exterior) rings — e.g. two islands.
    const islandA = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ];
    const islandB = [
      [20, 20],
      [20, 30],
      [30, 30],
      [30, 20],
      [20, 20],
    ];
    const out = toGeoJsonCandidate({ rings: [islandA, islandB] }) as {
      type: string;
      coordinates: unknown[];
    };
    expect(out.type).toBe("MultiPolygon");
    expect(out.coordinates).toHaveLength(2); // two separate polygons, no false holes
    expect(out.coordinates).toEqual([[islandA], [islandB]]);
  });

  it("attaches a counter-clockwise ring as a hole of its containing outer (#316)", () => {
    const outer = [
      [0, 0],
      [0, 10],
      [10, 10],
      [10, 0],
      [0, 0],
    ];
    // Counter-clockwise ring inside `outer` → a hole.
    const hole = [
      [2, 2],
      [8, 2],
      [8, 8],
      [2, 8],
      [2, 2],
    ];
    expect(toGeoJsonCandidate({ rings: [outer, hole] })).toEqual({
      type: "Polygon",
      coordinates: [outer, hole],
    });
  });

  it("translates a single ArcGIS path → GeoJSON LineString", () => {
    const path = [
      [0, 0],
      [1, 1],
      [2, 2],
    ];
    expect(toGeoJsonCandidate({ paths: [path] })).toEqual({
      type: "LineString",
      coordinates: path,
    });
  });

  it("translates multiple ArcGIS paths → GeoJSON MultiLineString", () => {
    const paths = [
      [
        [0, 0],
        [1, 1],
      ],
      [
        [2, 2],
        [3, 3],
      ],
    ];
    expect(toGeoJsonCandidate({ paths })).toEqual({
      type: "MultiLineString",
      coordinates: paths,
    });
  });

  it("translates an ArcGIS point → GeoJSON Point", () => {
    expect(toGeoJsonCandidate({ x: 12.5, y: -3.25 })).toEqual({
      type: "Point",
      coordinates: [12.5, -3.25],
    });
  });

  it("passes a GeoJSON geometry through unchanged", () => {
    const geom = {
      type: "Polygon",
      coordinates: [
        [
          [0, 0],
          [0, 1],
          [1, 1],
          [0, 0],
        ],
      ],
    };
    expect(toGeoJsonCandidate(geom)).toBe(geom);
  });

  it("passes a GeometryCollection through when it has geometries", () => {
    const gc = { type: "GeometryCollection", geometries: [] };
    expect(toGeoJsonCandidate(gc)).toBe(gc);
  });

  it.each([
    ["null", null],
    ["a string", "POINT(0 0)"],
    ["a number", 42],
    ["an empty object", {}],
    ["a plain record", { foo: "bar" }],
    ["a GeoJSON-typed value missing coordinates", { type: "Polygon" }],
    ["an unknown type", { type: "Wormhole", coordinates: [] }],
    ["only an x with no y", { x: 1 }],
  ])("returns null for %s", (_label, value) => {
    expect(toGeoJsonCandidate(value)).toBeNull();
  });
});

describe("looksLikeGeometry", () => {
  it.each([
    ["ArcGIS rings", { rings: [[[0, 0]]] }],
    ["ArcGIS paths", { paths: [[[0, 0]]] }],
    ["ArcGIS point", { x: 1, y: 2 }],
    ["GeoJSON Point", { type: "Point", coordinates: [0, 0] }],
  ])("is true for %s", (_label, value) => {
    expect(looksLikeGeometry(value)).toBe(true);
  });

  it.each([
    ["a string", "hello"],
    ["a number", 3],
    ["a plain object", { a: 1 }],
    ["null", null],
  ])("is false for %s", (_label, value) => {
    expect(looksLikeGeometry(value)).toBe(false);
  });
});

describe("extractSourceSrid", () => {
  it("defaults to 4326 for GeoJSON and unspecified references", () => {
    expect(extractSourceSrid({ type: "Point", coordinates: [0, 0] })).toBe(
      4326
    );
    expect(extractSourceSrid({ rings: [[[0, 0]]] })).toBe(4326);
    expect(extractSourceSrid("nonsense")).toBe(4326);
  });

  it("reads ArcGIS wkid", () => {
    expect(
      extractSourceSrid({ rings: [[[0, 0]]], spatialReference: { wkid: 4269 } })
    ).toBe(4269);
  });

  it("prefers latestWkid over wkid", () => {
    expect(
      extractSourceSrid({
        rings: [[[0, 0]]],
        spatialReference: { wkid: 102100, latestWkid: 3857 },
      })
    ).toBe(3857);
  });

  it("maps the ESRI web-mercator alias 102100 → 3857", () => {
    expect(
      extractSourceSrid({
        rings: [[[0, 0]]],
        spatialReference: { wkid: 102100 },
      })
    ).toBe(3857);
  });
});

describe("stampEsriSpatialReference", () => {
  const ROOT = { wkid: 102100, latestWkid: 3857 };

  it("stamps the response-root SR onto an Esri geometry lacking its own", () => {
    const record: Record<string, unknown> = {
      state: "CO",
      geometry: { rings: [[[0, 0]]] },
    };
    stampEsriSpatialReference(record, ROOT);
    expect(
      (record.geometry as Record<string, unknown>).spatialReference
    ).toEqual(ROOT);
    // And downstream SRID extraction now recovers it (102100 → 3857).
    expect(extractSourceSrid(record.geometry)).toBe(3857);
  });

  it("stamps paths and point shapes too", () => {
    const rec: Record<string, unknown> = {
      line: { paths: [[[0, 0]]] },
      pt: { x: 1, y: 2 },
    };
    stampEsriSpatialReference(rec, ROOT);
    expect((rec.line as Record<string, unknown>).spatialReference).toEqual(
      ROOT
    );
    expect((rec.pt as Record<string, unknown>).spatialReference).toEqual(ROOT);
  });

  it("never overwrites a geometry that already has its own SR", () => {
    const own = { wkid: 4269 };
    const rec: Record<string, unknown> = {
      geometry: { rings: [[[0, 0]]], spatialReference: own },
    };
    stampEsriSpatialReference(rec, ROOT);
    expect((rec.geometry as Record<string, unknown>).spatialReference).toBe(
      own
    );
  });

  it("is a no-op for GeoJSON (standard format — no rings/paths/x,y)", () => {
    const rec: Record<string, unknown> = {
      geometry: { type: "Polygon", coordinates: [[[0, 0]]] },
    };
    stampEsriSpatialReference(rec, ROOT);
    expect(
      (rec.geometry as Record<string, unknown>).spatialReference
    ).toBeUndefined();
  });

  it("is a no-op when the root reference has no wkid, or inputs aren't records", () => {
    const rec: Record<string, unknown> = { geometry: { rings: [[[0, 0]]] } };
    stampEsriSpatialReference(rec, { foo: "bar" });
    expect(
      (rec.geometry as Record<string, unknown>).spatialReference
    ).toBeUndefined();
    // Non-record record / root → no throw.
    expect(() => stampEsriSpatialReference(null, ROOT)).not.toThrow();
    expect(() => stampEsriSpatialReference(rec, null)).not.toThrow();
  });
});

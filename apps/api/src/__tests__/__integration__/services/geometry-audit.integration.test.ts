/**
 * Integration tests for GeometryAuditService (#316, slice 4).
 *
 * Runs against the live PostGIS extension + the `portal_try_geom_from_geojson`
 * helper (migration 0078). Asserts the three-way classification and the
 * unknown-SRID rejection.
 */

import { describe, it, expect, beforeAll, afterAll } from "@jest/globals";
import { drizzle } from "drizzle-orm/postgres-js";
import postgres from "postgres";

import { GeometryAuditService } from "../../../services/geometry-audit.service.js";
import type { DbClient } from "../../../db/repositories/base.repository.js";

describe("GeometryAuditService.auditBatch (#316)", () => {
  let connection!: ReturnType<typeof postgres>;
  let db!: DbClient;

  beforeAll(() => {
    if (!process.env.DATABASE_URL) {
      throw new Error("DATABASE_URL not set - setup.ts should have set this");
    }
    connection = postgres(process.env.DATABASE_URL, { max: 1 });
    db = drizzle(connection);
  });

  afterAll(async () => {
    await connection.end();
  });

  const VALID_POLYGON = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [0, 1],
        [1, 1],
        [1, 0],
        [0, 0],
      ],
    ],
  };
  // Self-intersecting "bowtie" — parses but ST_IsValid is false; repairable.
  const INVALID_POLYGON = {
    type: "Polygon",
    coordinates: [
      [
        [0, 0],
        [1, 1],
        [1, 0],
        [0, 1],
        [0, 0],
      ],
    ],
  };

  it("classifies clean / invalid / unparseable in one batch", async () => {
    const result = await GeometryAuditService.auditBatch(
      [
        { sourceId: "ok-1", geoJson: VALID_POLYGON },
        { sourceId: "repair-1", geoJson: INVALID_POLYGON },
        { sourceId: "reject-1", geoJson: { not: "a geometry" } },
        { sourceId: "reject-2", geoJson: "total garbage" },
        { sourceId: "reject-3", geoJson: null },
      ],
      { client: db }
    );

    expect(result.ok).toEqual(["ok-1"]);
    expect(result.repaired).toEqual(["repair-1"]);
    expect(result.rejected.map((r) => r.sourceId).sort()).toEqual([
      "reject-1",
      "reject-2",
      "reject-3",
    ]);
    // Every rejection names why, keyed by sourceId.
    for (const r of result.rejected) {
      expect(r.reason).toContain("GEOMETRY_INVALID_ON_IMPORT");
    }
  });

  it("returns empty result for an empty batch", async () => {
    const result = await GeometryAuditService.auditBatch([], { client: db });
    expect(result).toEqual({ ok: [], repaired: [], rejected: [] });
  });

  it("accepts a known non-4326 SRID (e.g. web mercator 3857)", async () => {
    const result = await GeometryAuditService.auditBatch(
      [{ sourceId: "merc-1", geoJson: VALID_POLYGON }],
      { client: db, srid: 3857 }
    );
    expect(result.ok).toEqual(["merc-1"]);
  });

  it("rejects the whole batch with GIS_SRID_UNSUPPORTED for an unknown SRID", async () => {
    const result = await GeometryAuditService.auditBatch(
      [
        { sourceId: "a", geoJson: VALID_POLYGON },
        { sourceId: "b", geoJson: VALID_POLYGON },
      ],
      { client: db, srid: 999999 }
    );
    expect(result.ok).toEqual([]);
    expect(result.repaired).toEqual([]);
    expect(result.rejected.map((r) => r.sourceId)).toEqual(["a", "b"]);
    for (const r of result.rejected) {
      expect(r.reason).toContain("GIS_SRID_UNSUPPORTED");
    }
  });
});

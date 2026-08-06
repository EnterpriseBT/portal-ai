/**
 * Geometry validity audit (#316, slice 4).
 *
 * Postgres — not Node — decides geometry validity, in one round-trip per
 * batch, *before* the write, so repairs and rejections can be counted and
 * attributed by `sourceId` rather than silently applied. This is the
 * fail-closed gate the sync path runs for every geometry-typed column: an
 * unparseable geometry is rejected and reported, never coerced to NULL.
 *
 * Classification per row:
 *   - parses + `ST_IsValid`      → **ok**       (written as-is)
 *   - parses + not `ST_IsValid`  → **repaired** (ST_MakeValid fixes it on write)
 *   - does not parse             → **rejected** (NOT written; reported)
 *
 * Parsing uses the `portal_try_geom_from_geojson` helper (migration 0078),
 * which swallows ST_GeomFromGeoJSON's throw so one bad row can't abort the
 * batch statement.
 */

import { sql } from "drizzle-orm";

import { db } from "../db/client.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import { ApiCode } from "../constants/api-codes.constants.js";

export interface GeometryAuditRow {
  sourceId: string;
  /** GeoJSON geometry object (already shape-normalized), or any candidate. */
  geoJson: unknown;
}

export interface GeometryAuditResult {
  /** Parsed clean — written as-is. */
  ok: string[];
  /** Parsed but invalid (self-intersection, ring order); repaired on write. */
  repaired: string[];
  /** Unparseable or non-geometry — NOT written; reported per row. */
  rejected: Array<{ sourceId: string; reason: string }>;
}

export interface GeometryAuditOptions {
  client?: DbClient;
  /**
   * Source SRID of the incoming geometries. Defaults to 4326 (GeoJSON's CRS).
   * A SRID absent from `spatial_ref_sys` cannot be reprojected, so every row
   * is rejected with `GIS_SRID_UNSUPPORTED`.
   */
  srid?: number;
}

export class GeometryAuditService {
  /**
   * Classify a batch of geometry candidates in one round-trip. Never throws
   * on bad geometry input — bad rows come back in `rejected`.
   */
  static async auditBatch(
    rows: GeometryAuditRow[],
    options: GeometryAuditOptions = {}
  ): Promise<GeometryAuditResult> {
    const { client = db, srid = 4326 } = options;
    const empty: GeometryAuditResult = { ok: [], repaired: [], rejected: [] };
    if (rows.length === 0) return empty;

    // An unknown SRID can't be reprojected — reject the whole batch with a
    // typed reason rather than write mislocated geometry.
    if (srid !== 4326) {
      const known = (await client.execute(
        sql`SELECT 1 FROM spatial_ref_sys WHERE srid = ${srid} LIMIT 1`
      )) as unknown as unknown[];
      if (known.length === 0) {
        return {
          ok: [],
          repaired: [],
          rejected: rows.map((r) => ({
            sourceId: r.sourceId,
            reason: `${ApiCode.GIS_SRID_UNSUPPORTED}: SRID ${srid} is not in spatial_ref_sys`,
          })),
        };
      }
    }

    // Bind one jsonb payload and expand it with `jsonb_to_recordset` — avoids
    // the fragility of binding parallel `::text[]` arrays. Each `gj` is the
    // GeoJSON re-serialized to text so the helper's `text` signature applies;
    // a null/undefined candidate becomes the string "null", which the helper
    // rejects (returns NULL) — exactly the desired classification.
    const payload = JSON.stringify(
      rows.map((r) => ({
        sid: r.sourceId,
        gj: JSON.stringify(r.geoJson ?? null),
      }))
    );

    const classified = (await client.execute(sql`
      SELECT
        t.sid AS "sourceId",
        CASE
          WHEN g.geom IS NULL THEN 'rejected'
          WHEN ST_IsValid(g.geom) THEN 'ok'
          ELSE 'repaired'
        END AS status
      FROM jsonb_to_recordset(${payload}::jsonb) AS t(sid text, gj text),
      LATERAL (SELECT portal_try_geom_from_geojson(t.gj) AS geom) g
    `)) as unknown as Array<{ sourceId: string; status: string }>;

    const result: GeometryAuditResult = { ok: [], repaired: [], rejected: [] };
    for (const row of classified) {
      if (row.status === "ok") result.ok.push(row.sourceId);
      else if (row.status === "repaired") result.repaired.push(row.sourceId);
      else
        result.rejected.push({
          sourceId: row.sourceId,
          reason: `${ApiCode.GEOMETRY_INVALID_ON_IMPORT}: geometry could not be parsed`,
        });
    }
    return result;
  }
}

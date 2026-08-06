/**
 * Heuristic column inference from a JSON record array.
 *
 * Pure leaf function — no I/O, no logging. Used by the probe pipeline
 * (`discoverColumns`) as the first inference layer; the AI-assist
 * layer (Haiku 4.5 classifier) operates on the output of this util
 * via `ApiClassifierCandidate` per column.
 *
 * The truth table follows the phase-4 spec:
 *
 * | Observed value classes      | Inferred ColumnDataType |
 * |-----------------------------|-------------------------|
 * | Only string                 | string                  |
 * | Only number                 | number                  |
 * | Only boolean                | boolean                 |
 * | Only object (object/array)  | json                    |
 * | Mixed scalars               | string                  |
 * | Mixed scalar + object       | json                    |
 * | All null / all missing      | string (defensive)      |
 *
 * The util never emits date / currency / enum — those refinements
 * come from the AI-assist layer.
 */
import type { ColumnDataType, GeoRole } from "@portalai/core/models";

import type { DiscoveredColumn } from "../adapter.interface.js";
import { looksLikeGeometry } from "./geometry.util.js";

export const MAX_SAMPLES_PER_COLUMN = 5;
/**
 * Probe samples are sliced to this many records before the heuristic
 * runs. The inference util itself doesn't slice; the adapter does.
 * Re-exported here so the adapter + tests share one source of truth.
 */
export const MAX_RECORDS_SCANNED = 25;

export interface InferenceResult {
  columns: DiscoveredColumn[];
  /** Up to MAX_SAMPLES_PER_COLUMN distinct non-null values per key. */
  samples: Record<string, unknown[]>;
}

type ValueClass = "null" | "string" | "number" | "boolean" | "object";

function classify(value: unknown): ValueClass {
  if (value === null || value === undefined) return "null";
  const t = typeof value;
  if (t === "string") return "string";
  if (t === "number") return "number";
  if (t === "boolean") return "boolean";
  // Arrays land here too — the spec treats them as the same "non-scalar"
  // class as plain objects.
  return "object";
}

function inferType(classes: Set<ValueClass>): ColumnDataType {
  const scalars = (["string", "number", "boolean"] as ValueClass[]).filter(
    (c) => classes.has(c)
  );
  const hasObject = classes.has("object");

  if (hasObject) return "json";
  if (scalars.length === 0) return "string"; // all null / no values
  if (scalars.length === 1) return scalars[0] as ColumnDataType;
  return "string"; // mixed scalars collapse
}

/**
 * #316: infer the coordinate-pair role for a numeric column from its key name
 * and observed value range. Deliberately conservative — a numeric column named
 * `lat`/`latitude` whose samples fall outside [-90, 90] is NOT tagged (it's
 * some other measurement), so a stray "latency" column can't be mislabeled.
 */
function inferGeoRole(key: string, samples: unknown[]): GeoRole | null {
  const name = key.toLowerCase();
  const numbers = samples.filter((v): v is number => typeof v === "number");
  if (numbers.length === 0) return null;
  const inRange = (min: number, max: number) =>
    numbers.every((n) => n >= min && n <= max);

  if ((name === "lat" || name === "latitude") && inRange(-90, 90)) {
    return "lat";
  }
  if (
    (name === "lng" ||
      name === "lon" ||
      name === "long" ||
      name === "longitude") &&
    inRange(-180, 180)
  ) {
    return "lng";
  }
  return null;
}

function pushDistinctSample(
  bucket: unknown[],
  value: unknown,
  seen: Set<string>
): void {
  if (bucket.length >= MAX_SAMPLES_PER_COLUMN) return;
  if (value === null || value === undefined) return;
  // Use JSON stringification for dedupe — sufficient for primitives and
  // structurally-identical objects, which is the only case worth
  // deduplicating in a sample preview.
  const key = typeof value === "object" ? JSON.stringify(value) : String(value);
  if (seen.has(key)) return;
  seen.add(key);
  bucket.push(value);
}

export function inferColumns(records: unknown[]): InferenceResult {
  if (records.length === 0) return { columns: [], samples: {} };

  // If any record is a non-object (primitive or array), the whole input
  // is treated as a single `value` column of type json. Mirrors the
  // spec §Inference rules step 2.
  const hasNonObject = records.some(
    (r) => r === null || typeof r !== "object" || Array.isArray(r)
  );
  if (hasNonObject) {
    const samples: unknown[] = [];
    const seen = new Set<string>();
    for (const r of records) pushDistinctSample(samples, r, seen);
    return {
      columns: [
        { key: "value", label: "Value", type: "json", required: false },
      ],
      samples: { value: samples },
    };
  }

  // Object records: collect union of top-level keys preserving first
  // appearance order so the output is stable.
  const keys: string[] = [];
  const seenKeys = new Set<string>();
  for (const r of records) {
    for (const k of Object.keys(r as Record<string, unknown>)) {
      if (!seenKeys.has(k)) {
        seenKeys.add(k);
        keys.push(k);
      }
    }
  }

  const columns: DiscoveredColumn[] = [];
  const samples: Record<string, unknown[]> = {};

  for (const key of keys) {
    const classes = new Set<ValueClass>();
    const bucket: unknown[] = [];
    const seenSamples = new Set<string>();
    let missingCount = 0;
    let nullCount = 0;

    for (const r of records) {
      const obj = r as Record<string, unknown>;
      const present = key in obj;
      if (!present) {
        missingCount++;
        continue;
      }
      const value = obj[key];
      const cls = classify(value);
      classes.add(cls);
      if (cls === "null") nullCount++;
      pushDistinctSample(bucket, value, seenSamples);
    }

    // Drop the "null" class from type inference (it doesn't influence
    // the type; only the required flag).
    classes.delete("null");

    let type = inferType(classes);
    let geoRole: GeoRole | null = null;

    // #316: refine the heuristic type/role for geospatial columns.
    // - object-typed columns whose every sample looks like a geometry
    //   (ArcGIS rings/paths/point or GeoJSON) become `geometry`, not `json`.
    // - numeric lat/lng columns (by name + range) carry a coordinate role.
    if (
      type === "json" &&
      bucket.length > 0 &&
      bucket.every(looksLikeGeometry)
    ) {
      type = "geometry";
    } else if (type === "number") {
      geoRole = inferGeoRole(key, bucket);
    }

    const required = missingCount === 0 && nullCount === 0;

    const column: DiscoveredColumn = { key, label: key, type, required };
    // Only attach a role when one was inferred — a column with no role omits
    // the key entirely (geometry columns included: geometry is a type).
    if (geoRole !== null) column.geoRole = geoRole;
    columns.push(column);
    samples[key] = bucket;
  }

  return { columns, samples };
}

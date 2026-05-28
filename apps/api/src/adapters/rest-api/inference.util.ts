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
import type { ColumnDataType } from "@portalai/core/models";

import type { DiscoveredColumn } from "../adapter.interface.js";

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
      columns: [{ key: "value", label: "Value", type: "json", required: false }],
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

    const type = inferType(classes);
    const required = missingCount === 0 && nullCount === 0;

    columns.push({ key, label: key, type, required });
    samples[key] = bucket;
  }

  return { columns, samples };
}

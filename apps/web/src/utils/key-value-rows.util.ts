import type { FormErrors } from "./form-validation.util";

/**
 * One editable row of a key/value table (#808): query params today, request
 * headers next (#809). `id` is a stable React key, so editing a key never
 * remounts its row and loses focus.
 */
export interface KeyValueRow {
  id: string;
  key: string;
  value: string;
}

let nextRowId = 0;

export function newKeyValueRow(key = "", value = ""): KeyValueRow {
  nextRowId += 1;
  return { id: `kv-${nextRowId}`, key, value };
}

export function recordToKeyValueRows(
  record: Record<string, string> | undefined
): KeyValueRow[] {
  return Object.entries(record ?? {}).map(([k, v]) => newKeyValueRow(k, v));
}

const isBlank = (row: KeyValueRow): boolean =>
  row.key.trim() === "" && row.value === "";

/**
 * The stored shape. Fully empty rows are dropped and keys are trimmed;
 * values are kept exactly as typed, since a space can be meaningful.
 * Run `validateKeyValueRows` first: a duplicate key here keeps the last.
 */
export function keyValueRowsToRecord(
  rows: KeyValueRow[]
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (isBlank(row)) continue;
    out[row.key.trim()] = row.value;
  }
  return out;
}

/** Whether any row survives `keyValueRowsToRecord` (isn't fully empty). */
export const hasKeyValueRows = (rows: KeyValueRow[]): boolean =>
  rows.some((row) => !isBlank(row));

/**
 * The `FormErrors` / touched key for a row's key field. Keyed by the row's
 * stable `id`, not its position, so removing a row never moves another row's
 * error or touched state onto its neighbour.
 */
export const keyValueRowErrorKey = (field: string, rowId: string): string =>
  `${field}.${rowId}.key`;

/** The `FormErrors` / touched key for a row's value field. */
export const keyValueRowValueErrorKey = (
  field: string,
  rowId: string
): string => `${field}.${rowId}.value`;

/**
 * A value with no key is an error, as is a key already used by an earlier
 * row (the later row carries the error). Fully empty rows are fine: they're
 * dropped on save.
 */
export function validateKeyValueRows(
  rows: KeyValueRow[],
  field: string
): FormErrors {
  const errors: FormErrors = {};
  const seen = new Set<string>();
  rows.forEach((row) => {
    if (isBlank(row)) return;
    const key = row.key.trim();
    if (key === "") {
      errors[keyValueRowErrorKey(field, row.id)] = "Key is required";
    } else if (seen.has(key)) {
      errors[keyValueRowErrorKey(field, row.id)] = "Duplicate key";
    }
    seen.add(key);
  });
  return errors;
}

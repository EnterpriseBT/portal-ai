/**
 * JSON reader for the demo REST source (#509) — `inventory.json` is a flat
 * top-level array of objects (the same asset the REST connector would sync from
 * the marketing site). Yields each element as `Record<string, string>` with
 * scalar values coerced to strings, matching the CSV/XLSX readers.
 */

import { readFileSync } from "node:fs";

export async function* readJsonRows(
  path: string
): AsyncGenerator<Record<string, string>> {
  const parsed = JSON.parse(readFileSync(path, "utf8")) as unknown;
  if (!Array.isArray(parsed)) {
    throw new Error(`demo seed: ${path} is not a top-level JSON array`);
  }
  for (const item of parsed as Array<Record<string, unknown>>) {
    const row: Record<string, string> = {};
    for (const [k, v] of Object.entries(item)) {
      row[k] = v === null || v === undefined ? "" : String(v);
    }
    yield row;
  }
}

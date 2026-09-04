/**
 * Streaming CSV reader for the demo fixtures (#509).
 *
 * Yields one `Record<string, string>` per data row (keyed by header), lazily —
 * the file is read line-by-line so peak memory is O(1 row), matching what
 * `importRows` wants. The committed fixtures never embed newlines inside a
 * field, so line-based parsing is safe; quoted fields (addresses contain
 * commas) and doubled `""` escapes are handled.
 */

import { createReadStream } from "node:fs";
import { createInterface } from "node:readline";

/** Parse one CSV line into fields (RFC-4180-ish: quotes + doubled `""`). */
export function parseCsvLine(line: string): string[] {
  const out: string[] = [];
  let field = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          inQuotes = false;
        }
      } else {
        field += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      out.push(field);
      field = "";
    } else {
      field += c;
    }
  }
  out.push(field);
  return out;
}

/** Stream data rows from a committed CSV fixture, keyed by header. */
export async function* readCsvRows(
  path: string
): AsyncGenerator<Record<string, string>> {
  const rl = createInterface({
    input: createReadStream(path, "utf8"),
    crlfDelay: Infinity,
  });
  let headers: string[] | null = null;
  for await (const line of rl) {
    if (line === "") continue;
    const fields = parseCsvLine(line);
    if (!headers) {
      headers = fields;
      continue;
    }
    const row: Record<string, string> = {};
    for (let i = 0; i < headers.length; i++) {
      row[headers[i]] = fields[i] ?? "";
    }
    yield row;
  }
}

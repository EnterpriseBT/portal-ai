/**
 * Server-side context-bloat mitigations for portal SQL responses.
 *
 * The LLM cannot opt out of these. Every `sql_query` response goes
 * through row-cap → cell-cap → payload-cap → metadata envelope in
 * that order:
 *
 *   - **Row cap**: keep at most `rowCap` rows (default 500). If more
 *     were available, attach `{ truncated: true, totalCount, hint }`.
 *   - **Cell cap**: replace any cell whose string representation
 *     exceeds `cellCap` bytes (default 500) with a truncation marker.
 *   - **Payload cap**: serialise the envelope; if over `payloadCap`
 *     bytes (default 100 KB), collapse to
 *     `{ truncated: true, sample, columnSizes, hint }`.
 *
 * Pure functions — no I/O. Unit-testable.
 */

export const PORTAL_SQL_DEFAULTS = {
  rowCap: 500,
  cellCap: 500,
  payloadCap: 100_000,
  truncatedSampleSize: 10,
} as const;

export type PortalSqlResponse =
  | {
      rows: Record<string, unknown>[];
      appliedLimit?: number | null;
    }
  | {
      rows: Record<string, unknown>[];
      truncated: true;
      totalCount: number;
      hint: string;
      appliedLimit?: number | null;
    }
  | {
      truncated: true;
      sample: Record<string, unknown>[];
      totalCount: number;
      columnSizes: Record<string, number>;
      hint: string;
    };

export interface RowCapResult {
  rows: Record<string, unknown>[];
  totalCount: number;
  capped: boolean;
}

export function applyRowCap(
  rows: Record<string, unknown>[],
  cap: number
): RowCapResult {
  if (rows.length <= cap) {
    return { rows, totalCount: rows.length, capped: false };
  }
  return {
    rows: rows.slice(0, cap),
    totalCount: rows.length,
    capped: true,
  };
}

export function applyCellCap(
  rows: Record<string, unknown>[],
  cap: number
): Record<string, unknown>[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(row)) {
      out[key] = capCell(value, cap);
    }
    return out;
  });
}

function capCell(value: unknown, cap: number): unknown {
  if (value === null || value === undefined) return value;
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (value instanceof Date) return value;
  // Strings, arrays, objects — serialise to string and check length.
  const str = typeof value === "string" ? value : JSON.stringify(value);
  if (str.length <= cap) return value;
  return `…<truncated, original ${str.length}b>`;
}

/**
 * Compose the response envelope from the row-capped + cell-capped
 * data. Collapses to the payload-cap envelope if the serialised
 * envelope still exceeds `payloadCap` bytes.
 */
export function buildResponse(
  rowsAfterCellCap: Record<string, unknown>[],
  totalCount: number,
  capped: boolean,
  appliedLimit: number | null,
  rowCap: number,
  payloadCap: number,
  sampleSize: number
): PortalSqlResponse {
  const envelope: PortalSqlResponse = capped
    ? {
        rows: rowsAfterCellCap,
        truncated: true as const,
        totalCount,
        hint: `result truncated to ${rowCap} rows. Add a LIMIT, narrow the WHERE, or aggregate.`,
        appliedLimit,
      }
    : { rows: rowsAfterCellCap, appliedLimit };

  const serialised = JSON.stringify(envelope);
  if (Buffer.byteLength(serialised, "utf8") <= payloadCap) {
    return envelope;
  }

  // Payload still over the cap after row + cell caps — collapse to a
  // minimal sample so the LLM gets something usable without blowing
  // its context window.
  const columnSizes = computeColumnSizes(rowsAfterCellCap);
  return {
    truncated: true as const,
    sample: rowsAfterCellCap.slice(0, sampleSize),
    totalCount,
    columnSizes,
    hint: `response exceeded ${payloadCap} bytes after row+cell caps. Project fewer columns or aggregate.`,
  };
}

function computeColumnSizes(
  rows: Record<string, unknown>[]
): Record<string, number> {
  if (rows.length === 0) return {};
  const sums: Record<string, number> = {};
  const counts: Record<string, number> = {};
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const size =
        value === null || value === undefined
          ? 0
          : typeof value === "string"
            ? Buffer.byteLength(value, "utf8")
            : Buffer.byteLength(JSON.stringify(value), "utf8");
      sums[key] = (sums[key] ?? 0) + size;
      counts[key] = (counts[key] ?? 0) + 1;
    }
  }
  const out: Record<string, number> = {};
  for (const key of Object.keys(sums)) {
    out[key] = Math.round((sums[key] ?? 0) / (counts[key] ?? 1));
  }
  return out;
}

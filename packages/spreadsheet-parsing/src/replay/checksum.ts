import { createHash } from "node:crypto";

/**
 * Stable, order-independent checksum over a record's field values. Matches
 * the legacy `apps/api/src/services/record-import.util.ts#computeChecksum`
 * format (SHA-256 hex, first 16 characters) so the plan-driven write path
 * can upsert into the same `entity_records.checksum` column without
 * migration.
 *
 * This module imports `node:crypto` and is exported **only** via the
 * `@portalai/spreadsheet-parsing/replay` subpath, which is Node-only. The
 * main parser entry stays browser-safe — see the package.json `exports`
 * map and the forbidden-deps audit.
 */
export function computeChecksum(fields: Record<string, unknown>): string {
  const keys = Object.keys(fields).sort();
  const json = JSON.stringify(fields, keys);
  return createHash("sha256").update(json).digest("hex").slice(0, 16);
}

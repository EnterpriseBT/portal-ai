/**
 * Pure helper that projects an `EntityRecord`-shaped payload into the
 * flat row shape the wide-table repo's `upsertMany` expects.
 *
 * The metadata block (`entity_record_id`, `organization_id`,
 * `synced_at`, `is_valid`, `source_id`) comes straight from the
 * `EntityRecordInsert`-ish record; each `normalizedData[k]` entry is
 * stamped under its sanitised wide-table column name `c_<...>` via the
 * caller-supplied `normalizedKey → columnName` map.
 *
 * Unknown normalised keys (no mapping) are silently skipped — the
 * caller's normaliser should already reject them, but defensive
 * skipping keeps the projection from emitting columns that don't exist
 * on the wide table. The repo's `upsertMany` also drops unknown
 * columns, so a stray key is a no-op rather than a Postgres error.
 */

/** Subset of EntityRecordInsert fields the wide-table side consumes. */
export interface WideRowSource {
  /** Wide-table primary key (also the `entity_records.id`). */
  id: string;
  organizationId: string;
  sourceId: string;
  syncedAt: number;
  isValid: boolean;
  /** Field-mapping `normalized_key` → value map. */
  normalizedData?: Record<string, unknown> | null;
}

export function projectToWideRow(
  record: WideRowSource,
  mappings: ReadonlyMap<string /* normalizedKey */, string /* columnName */>
): Record<string, unknown> {
  const out: Record<string, unknown> = {
    entity_record_id: record.id,
    organization_id: record.organizationId,
    synced_at: record.syncedAt,
    is_valid: record.isValid,
    source_id: record.sourceId,
  };
  const nd = record.normalizedData;
  if (nd) {
    for (const [normalizedKey, value] of Object.entries(nd)) {
      const columnName = mappings.get(normalizedKey);
      if (!columnName) continue;
      out[columnName] = value;
    }
  }
  return out;
}

/**
 * Build the `(normalizedKey → columnName)` map for an entity by
 * reading directly from the statement cache's column listing. The
 * cache already has both keys side by side from its
 * `field_mappings ↔ wide_table_columns` join.
 */
export function buildMappingsForProjection(
  cachedColumns: ReadonlyArray<{ normalizedKey: string; columnName: string }>
): ReadonlyMap<string, string> {
  return new Map(cachedColumns.map((c) => [c.normalizedKey, c.columnName]));
}

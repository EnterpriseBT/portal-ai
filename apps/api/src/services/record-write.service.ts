import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import {
  NormalizationService,
  type MappingWithColumnDef,
  type NormalizationResult,
} from "./normalization.service.js";
import { EntityRecordCountCache } from "./entity-record-count.cache.js";
import { ApiError } from "./http.service.js";
import { wideTableStatementCache } from "./wide-table-statement.cache.js";
import { assertNoRejectedGeometry } from "../utils/wide-table-rejection.util.js";
import type { DbClient } from "../db/repositories/base.repository.js";
import type { WideTableRejection } from "../db/repositories/wide-table.repository.js";

type Data = Record<string, unknown>;

/** The value the normalizer reads for a mapping: `normalizedKey` first. */
function sourceValue(m: MappingWithColumnDef, input: Data): unknown {
  return m.normalizedKey in input
    ? input[m.normalizedKey]
    : m.sourceField in input
      ? input[m.sourceField]
      : undefined;
}

/**
 * #760: the one write model for manual record writes (the record routes and
 * the agent's record tools). A record stores the normalizer's output, the
 * same values a revalidation would store, with its `isValid` and
 * `validationErrors`, so what the record shows and whether it counts as valid
 * always agree.
 */
export class RecordWriteService {
  /**
   * Normalize manual-write inputs against the entity's mappings.
   *
   * The normalizer turns a geometry it can't parse (`""`, `"nope"`) into
   * `null` with a validation error. A manual write refuses it instead, with
   * #757's 400, so nothing is written and the caller hears which field to fix
   * (a parseable value that isn't a geometry is refused later by the
   * wide-table audit, with the same code).
   */
  static normalize(
    mappings: MappingWithColumnDef[],
    rows: Array<{ sourceId: string; input: Data }>,
    opts: Parameters<typeof assertNoRejectedGeometry>[1] = {}
  ): NormalizationResult[] {
    const geometry = mappings.filter(
      (m) => m.columnDefinition?.type === "geometry"
    );
    const rejected: WideTableRejection[] = [];
    const results = rows.map(({ sourceId, input }) => {
      const result = NormalizationService.normalizeWithMappings(
        mappings,
        input
      );
      const fields = geometry
        .filter((m) => {
          const raw = sourceValue(m, input);
          return (
            raw !== null &&
            raw !== undefined &&
            result.normalizedData[m.normalizedKey] == null
          );
        })
        .map((m) => m.normalizedKey);
      if (fields.length > 0) {
        const code = ApiCode.GEOMETRY_INVALID_ON_IMPORT as const;
        rejected.push({
          sourceId,
          reason: "geometry is not valid JSON",
          code,
          fields,
          problems: [{ code, fields }],
        });
      }
      return result;
    });
    assertNoRejectedGeometry({ rejected }, opts);
    return results;
  }

  /**
   * Merge a patch into a record's stored raw `data`, which revalidation
   * rebuilds the record from. A `normalizedData` key is written where the
   * normalizer will read it: under the key the record already holds it by
   * (a synced record holds its source field), so a later sync of that field
   * still wins.
   */
  static mergePatch(
    mappings: MappingWithColumnDef[],
    existing: Data,
    patch: { data?: Data; normalizedData?: Data }
  ): Data {
    const merged: Data = { ...existing, ...patch.data };
    for (const [key, value] of Object.entries(patch.normalizedData ?? {})) {
      const m = mappings.find((x) => x.normalizedKey === key);
      const target =
        m && !(key in merged) && m.sourceField in merged ? m.sourceField : key;
      merged[target] = value;
    }
    return merged;
  }

  /**
   * Apply a PATCH to one record inside `tx`. The row is locked before its
   * `data` is read, so two concurrent edits can't overwrite each other; the
   * mappings are read in the same transaction. Writes the merged `data`, the
   * normalized values (every mapped column, as a revalidation would) and the
   * validity to both `entity_records` and the wide row. Throws `ApiError` 404
   * when the record is gone and 400 on a refused geometry; either way nothing
   * is written.
   */
  static async patchRecord(
    tx: DbClient,
    args: {
      connectorEntityId: string;
      recordId: string;
      patch: { data?: Data; normalizedData?: Data };
      userId: string;
    }
  ): Promise<NormalizationResult> {
    const { connectorEntityId, recordId, patch, userId } = args;
    const row = await DbService.repository.entityRecords.findByIdForUpdate(
      recordId,
      tx
    );
    if (!row || row.connectorEntityId !== connectorEntityId) {
      throw new ApiError(
        404,
        ApiCode.ENTITY_RECORD_NOT_FOUND,
        "Entity record not found"
      );
    }
    const mappings = await NormalizationService.loadMappings(
      connectorEntityId,
      tx
    );
    const merged = RecordWriteService.mergePatch(
      mappings,
      (row.data ?? {}) as Data,
      patch
    );
    const [result] = RecordWriteService.normalize(mappings, [
      { sourceId: row.sourceId, input: merged },
    ]);

    await DbService.repository.entityRecords.update(
      recordId,
      {
        data: merged,
        isValid: result.isValid,
        validationErrors: result.validationErrors,
        updated: Date.now(),
        updatedBy: userId,
      },
      tx
    );
    // Before the reconciler has run there is no wide row to write; the
    // reconcile fills it from `entity_records`.
    const stmt = await wideTableStatementCache.get(connectorEntityId, tx);
    if (stmt.columns.length > 0) {
      await DbService.repository.wideTable.updatePartial(
        connectorEntityId,
        recordId,
        result.normalizedData,
        { isValid: result.isValid },
        tx
      );
    }
    // `isValid` is part of the count fingerprint.
    await EntityRecordCountCache.invalidate(connectorEntityId);
    return result;
  }
}

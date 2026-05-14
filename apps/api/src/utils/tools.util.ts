import type { SQL } from "drizzle-orm";

import type { StationData } from "../services/analytics.service.js";
import { wideTableRepo } from "../db/repositories/wide-table.repository.js";

/**
 * Resolve `entityKey` to its `connectorEntityId` via the station's
 * loaded entity metadata. Throws if the entity isn't reachable from
 * this station (the LLM passed a key the station doesn't know).
 */
export function resolveEntityId(
  stationData: StationData,
  entityKey: string
): string {
  const entity = stationData.entities.find((e) => e.key === entityKey);
  if (!entity) {
    throw new Error(`Entity "${entityKey}" not found in loaded station data`);
  }
  return entity.id;
}

/**
 * Postgres-direct row fetch for the math tool surface (Phase 3 slice 3).
 *
 * Resolves the LLM-supplied `entityKey` to a `connectorEntityId` via
 * the station's loaded metadata, then projects only the columns the
 * math kernel needs. The result is keyed by `normalizedKey` (matching
 * what `fetchProjectedRows` returns) plus a synthetic `_record_id`
 * column — math methods that key on column names continue to work
 * untouched.
 *
 * Pass `columns: "*"` to project every live column for the entity
 * (used by `resolve_identity` which returns whole matched rows).
 *
 * @param opts.where  Optional Drizzle SQL fragment ANDed into the
 *                    WHERE clause. Caller is responsible for ensuring
 *                    the fragment references only columns that exist
 *                    on the entity's wide table.
 * @param opts.limit  Optional per-call row cap.
 */
export async function fetchEntityRows(
  stationData: StationData,
  entityKey: string,
  columns: ReadonlyArray<string> | "*",
  organizationId: string,
  opts?: { where?: SQL; limit?: number }
): Promise<Record<string, unknown>[]> {
  const entityId = resolveEntityId(stationData, entityKey);
  let columnList: ReadonlyArray<string>;
  if (columns === "*") {
    const entity = stationData.entities.find((e) => e.id === entityId);
    columnList = entity?.columns.map((c) => c.key) ?? [];
  } else {
    columnList = columns;
  }
  return wideTableRepo.fetchProjectedRows(entityId, columnList, {
    organizationId,
    where: opts?.where,
    limit: opts?.limit,
  });
}

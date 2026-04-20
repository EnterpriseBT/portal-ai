/**
 * Reconcile `FieldMapping` rows for a connector entity against a union of
 * `ColumnBinding`s from one or more plan regions.
 *
 * - Dedupes input bindings by `columnDefinitionId` (two regions binding the
 *   same column definition produce **one** `FieldMapping`).
 * - Soft-deletes mappings that are no longer in the union (so patched plans
 *   that drop a binding also drop the corresponding mapping).
 * - Upserts remaining mappings via
 *   `fieldMappings.upsertByEntityAndNormalizedKey` — the conflict target is
 *   `(connectorEntityId, normalizedKey)`, matching the legacy upload flow's
 *   invariant.
 *
 * Derives `normalizedKey` from the `ColumnDefinition.key` in the org catalog.
 * Falls back to `columnDefinitionId` when the catalog entry is missing; the
 * caller should treat that as a rare recoverable case (column definition
 * was dropped after the plan was drawn).
 */

import { and, eq, inArray } from "drizzle-orm";

import type {
  ColumnDefinitionSelect,
  FieldMappingSelect,
} from "../../db/schema/zod.js";
import { fieldMappings } from "../../db/schema/index.js";
import type { DbClient } from "../../db/repositories/base.repository.js";
import { DbService } from "../db.service.js";
import { SystemUtilities } from "../../utils/system.util.js";
import { db } from "../../db/client.js";

export interface PlanBinding {
  columnDefinitionId: string;
  sourceField: string;
  isPrimaryKey?: boolean;
}

export interface ReconcileFieldMappingsInput {
  connectorEntityId: string;
  organizationId: string;
  userId: string;
  bindings: PlanBinding[];
  catalogById: Map<string, ColumnDefinitionSelect>;
}

export async function reconcileFieldMappings(
  input: ReconcileFieldMappingsInput,
  client: DbClient = db
): Promise<FieldMappingSelect[]> {
  const { connectorEntityId, organizationId, userId, bindings, catalogById } =
    input;

  // Dedupe by columnDefinitionId, preserving the first occurrence's metadata.
  const byColumnDefId = new Map<string, PlanBinding>();
  for (const binding of bindings) {
    if (!byColumnDefId.has(binding.columnDefinitionId)) {
      byColumnDefId.set(binding.columnDefinitionId, binding);
    }
  }

  // Compute desired (normalizedKey → binding) pairs using the catalog for the
  // canonical normalized key. Bindings whose catalog entry is missing use the
  // columnDefinitionId as the normalized key — these should be rare after
  // classify-columns runs.
  const desired = Array.from(byColumnDefId.values()).map((binding) => ({
    binding,
    normalizedKey:
      catalogById.get(binding.columnDefinitionId)?.key ??
      binding.columnDefinitionId,
  }));

  // Soft-delete existing mappings whose normalizedKey is no longer desired.
  const now = Date.now();
  const existing = await (client as typeof db)
    .select()
    .from(fieldMappings)
    .where(
      and(
        eq(fieldMappings.connectorEntityId, connectorEntityId),
        eq(fieldMappings.organizationId, organizationId)
      )
    );
  const desiredKeys = new Set(desired.map((d) => d.normalizedKey));
  const staleIds = (existing as FieldMappingSelect[])
    .filter((m) => !desiredKeys.has(m.normalizedKey) && m.deleted === null)
    .map((m) => m.id);
  if (staleIds.length > 0) {
    await (client as typeof db)
      .update(fieldMappings)
      .set({ deleted: now, deletedBy: userId })
      .where(inArray(fieldMappings.id, staleIds));
  }

  // Upsert each desired mapping.
  const results: FieldMappingSelect[] = [];
  for (const { binding, normalizedKey } of desired) {
    const catalog = catalogById.get(binding.columnDefinitionId);
    const row =
      await DbService.repository.fieldMappings.upsertByEntityAndNormalizedKey(
        {
          id: SystemUtilities.id.v4.generate(),
          organizationId,
          connectorEntityId,
          columnDefinitionId: binding.columnDefinitionId,
          sourceField: binding.sourceField,
          isPrimaryKey: binding.isPrimaryKey ?? false,
          normalizedKey,
          required: false,
          defaultValue: null,
          format: catalog?.canonicalFormat ?? null,
          enumValues: null,
          refNormalizedKey: null,
          refEntityKey: null,
          created: now,
          createdBy: userId,
          updated: null,
          updatedBy: null,
          deleted: null,
          deletedBy: null,
        },
        client
      );
    results.push(row);
  }

  return results;
}

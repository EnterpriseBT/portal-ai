/**
 * Reconcile `FieldMapping` rows for a connector entity against a union of
 * `ColumnBinding`s from one or more plan regions.
 *
 * - Drops bindings with `excluded: true` up-front so commit writes no row
 *   for them (and soft-deletes any previously-live mapping on a re-commit).
 * - Dedupes the remaining bindings by `columnDefinitionId` (two regions
 *   binding the same column definition produce **one** `FieldMapping`).
 * - Honors per-binding overrides (`normalizedKey`, `required`, `defaultValue`,
 *   `format`, `enumValues`, `refEntityKey`, `refNormalizedKey`) with catalog
 *   fallbacks. See `docs/BINDING_OVERRIDES.spec.md`.
 * - Validates normalized-key regex + uniqueness across the desired set
 *   (`LAYOUT_PLAN_INVALID_PAYLOAD` / `LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY`).
 * - Validates reference-typed bindings against the caller-supplied set of
 *   staged entity keys and an on-demand lookup of existing org entities
 *   (`LAYOUT_PLAN_INVALID_REFERENCE`).
 * - Soft-deletes mappings that are no longer in the union (so patched plans
 *   that drop or exclude a binding also drop the corresponding mapping).
 */

import { and, eq, inArray, isNull } from "drizzle-orm";
import { sourceFieldToNormalizedKey } from "@portalai/spreadsheet-parsing";

import type {
  ColumnDefinitionSelect,
  FieldMappingSelect,
} from "../../db/schema/zod.js";
import {
  connectorEntities,
  fieldMappings,
} from "../../db/schema/index.js";
import type { DbClient } from "../../db/repositories/base.repository.js";
import { DbService } from "../db.service.js";
import { SystemUtilities } from "../../utils/system.util.js";
import { db } from "../../db/client.js";
import { ApiError } from "../http.service.js";
import { ApiCode } from "../../constants/api-codes.constants.js";

const NORMALIZED_KEY_PATTERN = /^[a-z][a-z0-9_]*$/;

const REFERENCE_COLUMN_TYPES: ReadonlySet<string> = new Set([
  "reference",
  "reference-array",
]);

export interface PlanBinding {
  columnDefinitionId: string;
  sourceField: string;
  isPrimaryKey?: boolean;
  // ── Overrides (all optional; commit falls back to catalog defaults) ──
  excluded?: boolean;
  normalizedKey?: string;
  required?: boolean;
  defaultValue?: string | null;
  format?: string | null;
  enumValues?: string[] | null;
  refEntityKey?: string | null;
  refNormalizedKey?: string | null;
}

export interface ReconcileFieldMappingsInput {
  connectorEntityId: string;
  organizationId: string;
  userId: string;
  bindings: PlanBinding[];
  catalogById: Map<string, ColumnDefinitionSelect>;
  /**
   * Entity keys from sibling regions in the same commit. Reference bindings
   * resolve against this set first, then fall back to existing DB entities
   * (via a query against `connector_entities` scoped to the org).
   */
  stagedEntityKeys?: Set<string>;
  /**
   * Map from staged entity key to the normalized-key set derived from that
   * entity's bindings in the same commit. Reference bindings whose
   * `refEntityKey` points at a staged entity validate `refNormalizedKey`
   * against the matching set.
   */
  stagedNormalizedKeysByEntityKey?: Map<string, Set<string>>;
}

/**
 * Resolve the normalized key for a binding — the explicit override wins,
 * falling back to a name **derived from the source field** (so two bindings
 * pointing at different columns end up on different `FieldMapping` rows
 * even when they share a `ColumnDefinition`). `catalogById` is accepted for
 * parity with existing callers but only used as a last-ditch fallback when
 * the source field is absent — which shouldn't happen in practice.
 *
 * Exported so `layout-plan-commit.service.ts` can precompute the staged
 * normalized-key map for cross-region ref validation using the same logic
 * reconcile uses.
 */
export function resolveNormalizedKey(
  binding: PlanBinding,
  catalogById: Map<string, ColumnDefinitionSelect>
): string {
  if (binding.normalizedKey) return binding.normalizedKey;
  if (binding.sourceField) {
    return sourceFieldToNormalizedKey(binding.sourceField);
  }
  return (
    catalogById.get(binding.columnDefinitionId)?.key ??
    binding.columnDefinitionId
  );
}

export async function reconcileFieldMappings(
  input: ReconcileFieldMappingsInput,
  client: DbClient = db
): Promise<FieldMappingSelect[]> {
  const {
    connectorEntityId,
    organizationId,
    userId,
    bindings,
    catalogById,
    stagedEntityKeys,
    stagedNormalizedKeysByEntityKey,
  } = input;

  // Drop excluded bindings up-front — they contribute no FieldMapping row
  // (and any existing row with their derived key gets soft-deleted by the
  // stale-detection path below).
  const active = bindings.filter((b) => b.excluded !== true);

  // Dedupe by columnDefinitionId, preserving the first occurrence's metadata.
  const byColumnDefId = new Map<string, PlanBinding>();
  for (const binding of active) {
    if (!byColumnDefId.has(binding.columnDefinitionId)) {
      byColumnDefId.set(binding.columnDefinitionId, binding);
    }
  }

  // Resolve normalized keys + enforce regex on explicit overrides.
  const desired = Array.from(byColumnDefId.values()).map((binding) => {
    if (
      binding.normalizedKey !== undefined &&
      !NORMALIZED_KEY_PATTERN.test(binding.normalizedKey)
    ) {
      throw new ApiError(
        400,
        ApiCode.LAYOUT_PLAN_INVALID_PAYLOAD,
        `Invalid normalizedKey override "${binding.normalizedKey}" for columnDefinitionId ${binding.columnDefinitionId} — must match ${NORMALIZED_KEY_PATTERN}`
      );
    }
    return {
      binding,
      normalizedKey: resolveNormalizedKey(binding, catalogById),
    };
  });

  // Reject two bindings (different columnDefinitionId) that resolve to the
  // same normalizedKey — FieldMapping is keyed on (connectorEntityId,
  // normalizedKey), so a collision would silently overwrite data.
  const seen = new Map<string, string>();
  for (const { binding, normalizedKey } of desired) {
    const prior = seen.get(normalizedKey);
    if (prior !== undefined && prior !== binding.columnDefinitionId) {
      throw new ApiError(
        400,
        ApiCode.LAYOUT_PLAN_DUPLICATE_NORMALIZED_KEY,
        `Duplicate normalizedKey "${normalizedKey}" — bindings to ${prior} and ${binding.columnDefinitionId} collide. Rename one of the overrides.`
      );
    }
    seen.set(normalizedKey, binding.columnDefinitionId);
  }

  // Reference validation — resolve target entity + refNormalizedKey per
  // reference-typed binding. DB lookups are cached within this call.
  const dbEntityFieldMappingCache = new Map<string, Set<string> | null>();
  for (const { binding } of desired) {
    const catalog = catalogById.get(binding.columnDefinitionId);
    if (!catalog || !REFERENCE_COLUMN_TYPES.has(catalog.type)) continue;

    const refKey = binding.refEntityKey;
    if (refKey === undefined || refKey === null || refKey === "") {
      throw new ApiError(
        400,
        ApiCode.LAYOUT_PLAN_INVALID_REFERENCE,
        `Reference-typed binding for columnDefinitionId ${binding.columnDefinitionId} requires refEntityKey`
      );
    }

    const matchesStaged = stagedEntityKeys?.has(refKey) === true;
    let matchesDb = false;
    if (!matchesStaged) {
      matchesDb =
        (await lookupDbEntityNormalizedKeys(
          client,
          organizationId,
          refKey,
          dbEntityFieldMappingCache
        )) !== null;
    }
    if (!matchesStaged && !matchesDb) {
      throw new ApiError(
        400,
        ApiCode.LAYOUT_PLAN_INVALID_REFERENCE,
        `refEntityKey "${refKey}" does not match a staged region or an existing entity in the organization`
      );
    }

    if (
      binding.refNormalizedKey !== undefined &&
      binding.refNormalizedKey !== null &&
      binding.refNormalizedKey !== ""
    ) {
      const targetKeys = matchesStaged
        ? stagedNormalizedKeysByEntityKey?.get(refKey) ?? new Set<string>()
        : (await lookupDbEntityNormalizedKeys(
            client,
            organizationId,
            refKey,
            dbEntityFieldMappingCache
          )) ?? new Set<string>();
      if (!targetKeys.has(binding.refNormalizedKey)) {
        throw new ApiError(
          400,
          ApiCode.LAYOUT_PLAN_INVALID_REFERENCE,
          `refNormalizedKey "${binding.refNormalizedKey}" does not resolve to a field on entity "${refKey}"`
        );
      }
    }
  }

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
          required: binding.required ?? false,
          defaultValue: binding.defaultValue ?? null,
          format:
            binding.format !== undefined
              ? binding.format
              : catalog?.canonicalFormat ?? null,
          enumValues: binding.enumValues ?? null,
          refNormalizedKey: binding.refNormalizedKey ?? null,
          refEntityKey: binding.refEntityKey ?? null,
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

/**
 * Return the set of non-deleted `FieldMapping.normalizedKey`s on the
 * org-scoped entity identified by `key`, or `null` when no such entity
 * exists. Results are cached per-call via the shared `cache` map so a plan
 * referencing the same target multiple times only hits the DB once.
 *
 * Under C2 `(organization_id, key)` is unique (partial index on `deleted
 * IS NULL`), so at most one entity matches — `.limit(1)` is a
 * belt-and-braces guard, not a disambiguator. See
 * `docs/REGION_CONFIG.c2_org_unique_entity_key.spec.md`.
 */
async function lookupDbEntityNormalizedKeys(
  client: DbClient,
  organizationId: string,
  entityKey: string,
  cache: Map<string, Set<string> | null>
): Promise<Set<string> | null> {
  if (cache.has(entityKey)) {
    return cache.get(entityKey) as Set<string> | null;
  }
  const [entity] = await (client as typeof db)
    .select()
    .from(connectorEntities)
    .where(
      and(
        eq(connectorEntities.organizationId, organizationId),
        eq(connectorEntities.key, entityKey),
        isNull(connectorEntities.deleted)
      )
    )
    .limit(1);
  if (!entity) {
    cache.set(entityKey, null);
    return null;
  }
  const mappings = (await (client as typeof db)
    .select()
    .from(fieldMappings)
    .where(
      eq(fieldMappings.connectorEntityId, (entity as { id: string }).id)
    )) as FieldMappingSelect[];
  const keys = new Set(
    mappings.filter((m) => m.deleted === null).map((m) => m.normalizedKey)
  );
  cache.set(entityKey, keys);
  return keys;
}

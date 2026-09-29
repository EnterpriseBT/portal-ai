import { inArray } from "drizzle-orm";

import type { ColumnDataType } from "@portalai/core/models";

import { columnDefinitions } from "../db/schema/index.js";
import { fieldMappingsRepo } from "../db/repositories/field-mappings.repository.js";
import { columnDefinitionsRepo } from "../db/repositories/column-definitions.repository.js";
import type { ResolvedColumn } from "../adapters/adapter.interface.js";

/**
 * Resolve an entity's columns (field mapping ⋈ column definition) into the
 * `ResolvedColumn[]` shape the filter layer + record serialization consume.
 *
 * Extracted from `entity-record.router` (#599 slice 4) so curated-view row
 * filters can build the same `normalizedKey → ColumnDataType` map the entity-
 * records filter uses. One batched column-definition read (#433) — not one
 * round-trip per column.
 */
export async function resolveColumns(
  connectorEntityId: string
): Promise<ResolvedColumn[]> {
  const mappings =
    await fieldMappingsRepo.findByConnectorEntityId(connectorEntityId);
  if (mappings.length === 0) return [];

  const colDefIds = [...new Set(mappings.map((m) => m.columnDefinitionId))];
  const colDefs = await columnDefinitionsRepo.findMany(
    inArray(columnDefinitions.id, colDefIds)
  );

  const colDefMap = new Map(colDefs.map((cd) => [cd.id, cd]));

  return mappings.reduce<ResolvedColumn[]>((acc, m) => {
    const cd = colDefMap.get(m.columnDefinitionId);
    if (!cd) return acc;
    acc.push({
      key: cd.key,
      label: cd.label,
      type: cd.type as ColumnDataType,
      normalizedKey: m.normalizedKey,
      required: m.required,
      enumValues: m.enumValues ?? null,
      defaultValue: m.defaultValue ?? null,
      format: m.format ?? null,
      validationPattern: cd.validationPattern ?? null,
      canonicalFormat: cd.canonicalFormat ?? null,
    });
    return acc;
  }, []);
}

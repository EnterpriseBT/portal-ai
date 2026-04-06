/**
 * Shared adapter utilities for import-mode connectors.
 *
 * Import-mode connectors (CSV, Sandbox, etc.) all read from the local
 * `entity_records` table. This module extracts the common `queryRows`
 * implementation so each adapter can reuse it without duplication.
 */

import type { ConnectorInstance } from "@portalai/core/models";
import type { ColumnDataType } from "@portalai/core/models";

import type {
  EntityDataQuery,
  EntityDataResult,
  ColumnDefinitionSummary,
} from "../adapters/adapter.interface.js";
import { connectorEntitiesRepo } from "../db/repositories/connector-entities.repository.js";
import { entityRecordsRepo } from "../db/repositories/entity-records.repository.js";
import { fieldMappingsRepo } from "../db/repositories/field-mappings.repository.js";
import { columnDefinitionsRepo } from "../db/repositories/column-definitions.repository.js";
import type { DbClient } from "../db/repositories/base.repository.js";

// ── Helpers ─────────────────────────────────────────────────────────

/**
 * Resolve the column metadata for an entity by loading its field
 * mappings and their associated column definitions.
 */
export async function resolveColumns(
  connectorEntityId: string,
  _organizationId: string,
  client?: DbClient
): Promise<ColumnDefinitionSummary[]> {
  const mappings = await fieldMappingsRepo.findByConnectorEntityId(
    connectorEntityId,
    client
  );
  if (mappings.length === 0) return [];

  const colDefIds = [...new Set(mappings.map((m) => m.columnDefinitionId))];

  const colDefs = await Promise.all(
    colDefIds.map((id) =>
      columnDefinitionsRepo.findById(id, client)
    )
  );

  const colDefMap = new Map(
    colDefs
      .filter((cd): cd is NonNullable<typeof cd> => cd != null)
      .map((cd) => [cd.id, cd])
  );

  return mappings.reduce<ColumnDefinitionSummary[]>((acc, m) => {
    const cd = colDefMap.get(m.columnDefinitionId);
    if (!cd) return acc;
    acc.push({
      key: cd.key,
      label: cd.label,
      type: cd.type as ColumnDataType,
      required: m.required,
      enumValues: m.enumValues ?? null,
      defaultValue: m.defaultValue ?? null,
      validationPattern: cd.validationPattern ?? null,
      canonicalFormat: cd.canonicalFormat ?? null,
    });
    return acc;
  }, []);
}

// ── Import-mode queryRows ───────────────────────────────────────────

/**
 * Generic `queryRows` implementation for import-mode connectors.
 *
 * Reads cached entity records, resolves column metadata from field
 * mappings + column definitions, and applies pagination/sort/filter
 * on the `normalizedData` JSONB field.
 */
export async function importModeQueryRows(
  instance: ConnectorInstance,
  query: EntityDataQuery
): Promise<EntityDataResult> {
  // Resolve the connector entity by key
  const entity = await connectorEntitiesRepo.findByKey(
    instance.id,
    query.entityKey
  );
  if (!entity) {
    return { rows: [], total: 0, columns: [], source: "cache" };
  }

  // Load column metadata
  const columns = await resolveColumns(
    entity.id,
    entity.organizationId
  );

  // Build a set of requested column keys for filtering
  const requestedKeys = query.columns
    ? new Set(query.columns)
    : null;

  // Fetch records from entity_records
  const [records, total] = await Promise.all([
    entityRecordsRepo.findByConnectorEntityId(entity.id, {
      limit: query.limit,
      offset: query.offset,
    }),
    entityRecordsRepo.countByConnectorEntityId(entity.id),
  ]);

  // Map records to rows (normalizedData only)
  let rows: Record<string, unknown>[] = records.map((r) => {
    const data = (r.normalizedData ?? {}) as Record<string, unknown>;
    if (!requestedKeys) return data;
    // Filter to requested columns only
    const filtered: Record<string, unknown> = {};
    for (const key of requestedKeys) {
      if (key in data) filtered[key] = data[key];
    }
    return filtered;
  });

  // Apply filters on normalizedData
  if (query.filters) {
    for (const [key, filter] of Object.entries(query.filters)) {
      rows = rows.filter((row) => {
        const val = row[key];
        switch (filter.op) {
          case "eq":
            return val === filter.value;
          case "neq":
            return val !== filter.value;
          case "contains":
            return (
              typeof val === "string" &&
              typeof filter.value === "string" &&
              val.toLowerCase().includes(filter.value.toLowerCase())
            );
          case "gt":
            return (
              typeof val === "number" &&
              typeof filter.value === "number" &&
              val > filter.value
            );
          case "lt":
            return (
              typeof val === "number" &&
              typeof filter.value === "number" &&
              val < filter.value
            );
          default:
            return true;
        }
      });
    }
  }

  // Apply sort on normalizedData
  if (query.sort) {
    const { column, direction } = query.sort;
    rows.sort((a, b) => {
      const aVal = a[column];
      const bVal = b[column];
      if (aVal == null && bVal == null) return 0;
      if (aVal == null) return 1;
      if (bVal == null) return -1;
      if (typeof aVal === "string" && typeof bVal === "string") {
        return direction === "asc"
          ? aVal.localeCompare(bVal)
          : bVal.localeCompare(aVal);
      }
      if (typeof aVal === "number" && typeof bVal === "number") {
        return direction === "asc" ? aVal - bVal : bVal - aVal;
      }
      return 0;
    });
  }

  // Filter columns to requested set
  const filteredColumns = requestedKeys
    ? columns.filter((c) => requestedKeys.has(c.key))
    : columns;

  return {
    rows,
    total,
    columns: filteredColumns,
    source: "cache",
  };
}

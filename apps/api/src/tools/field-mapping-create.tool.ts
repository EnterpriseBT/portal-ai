/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { FieldMappingModelFactory } from "@portalai/core/models";
import {
  assertStationScope,
  assertWriteCapability,
} from "../utils/resolve-capabilities.util.js";
import { Repository } from "../db/repositories/base.repository.js";
import { wideTableReconcilerService } from "../services/wide-table-reconciler.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "field-mapping-create-tool" });

const ItemSchema = z.object({
  connectorEntityId: z
    .string()
    .describe("The connector entity to create the mapping for"),
  columnDefinitionId: z.string().describe("The column definition to map to"),
  sourceField: z
    .string()
    .min(1)
    .describe("The source field name in the raw data"),
  isPrimaryKey: z
    .boolean()
    .optional()
    .describe("Whether this mapping is a primary key"),
  normalizedKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .refine((s) => !/^c_/.test(s), {
      message:
        "normalizedKey must NOT start with `c_` — the system reserves that prefix for the physical wide-table column name and adds it automatically. Use the base name (e.g. `diameter_avg_km`, not `c_diameter_avg_km`). The resulting wide column will be `c_<normalizedKey>`.",
    })
    .describe(
      "The base snake_case key for the field (e.g. `diameter_avg_km`). " +
        "**Do NOT prefix with `c_`** — the system reserves that prefix for " +
        "the physical wide-table column name (`c_<normalizedKey>`) and " +
        "adds it automatically. When you see a column rendered as " +
        "`c_diameter_avg_km` in `station_context.columns[].wideColumnName`, " +
        "the corresponding `key` is `diameter_avg_km`, not " +
        "`c_diameter_avg_km`."
    ),
  required: z.boolean().optional().describe("Whether this field is required"),
  defaultValue: z
    .string()
    .nullable()
    .optional()
    .describe("Default value for the field"),
  format: z
    .string()
    .nullable()
    .optional()
    .describe("Format string for the field"),
  enumValues: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Allowed enum values for the field"),
});

const InputSchema = z.object({
  items: z
    .array(ItemSchema)
    .min(1)
    .max(100)
    .describe("Field mappings to create (1–100)"),
});

export class FieldMappingCreateTool extends Tool<typeof InputSchema> {
  slug = "field_mapping_create";
  name = "Field Mapping Create Tool";
  description =
    "Creates or updates one or more field mappings between source fields and column definitions. Accepts 1–100 items.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { items } = this.validate(input);

          // ── Phase 1: Validate ──────────────────────────────────────
          const failures: { index: number; error: string }[] = [];

          // Group by connectorEntityId for scope checks
          const entityGroups = new Map<string, typeof items>();
          for (const item of items) {
            const group = entityGroups.get(item.connectorEntityId) ?? [];
            group.push(item);
            entityGroups.set(item.connectorEntityId, group);
          }

          for (const connectorEntityId of entityGroups.keys()) {
            try {
              await assertStationScope(stationId, connectorEntityId);
              await assertWriteCapability(connectorEntityId);
            } catch (err: any) {
              for (const item of entityGroups.get(connectorEntityId)!) {
                failures.push({
                  index: items.indexOf(item),
                  error: err.message ?? "Scope/capability check failed",
                });
              }
            }
          }

          if (failures.length > 0) {
            return {
              success: false,
              error: `${failures.length} of ${items.length} items failed validation`,
              failures,
            };
          }

          // Batch-load unique column definitions
          const uniqueColDefIds = [
            ...new Set(items.map((item) => item.columnDefinitionId)),
          ];
          const colDefMap = new Map<string, any>();
          for (const id of uniqueColDefIds) {
            const colDef =
              await DbService.repository.columnDefinitions.findById(id);
            if (colDef) colDefMap.set(id, colDef);
          }

          // Validate each item's column definition
          for (let i = 0; i < items.length; i++) {
            const colDef = colDefMap.get(items[i].columnDefinitionId);
            if (!colDef || colDef.organizationId !== organizationId) {
              failures.push({ index: i, error: "Column definition not found" });
            }
          }

          if (failures.length > 0) {
            return {
              success: false,
              error: `${failures.length} of ${items.length} items failed validation`,
              failures,
            };
          }

          // ── Phase 2: Execute ───────────────────────────────────────
          const factory = new FieldMappingModelFactory();
          const results: { id: string }[] = [];

          await Repository.transaction(async (tx) => {
            for (const item of items) {
              const model = factory.create(userId);
              model.update({
                organizationId,
                connectorEntityId: item.connectorEntityId,
                columnDefinitionId: item.columnDefinitionId,
                sourceField: item.sourceField,
                isPrimaryKey: item.isPrimaryKey ?? false,
                normalizedKey: item.normalizedKey,
                required: item.required ?? false,
                defaultValue: item.defaultValue ?? null,
                format: item.format ?? null,
                enumValues: item.enumValues ?? null,
                refNormalizedKey: null,
                refEntityKey: null,
              });
              const result =
                await DbService.repository.fieldMappings.upsertByEntityAndNormalizedKey(
                  model.parse(),
                  tx
                );
              results.push(result);
            }
          });

          // Reconcile the wide-table for each affected entity so the
          // new field mappings materialize as physical `c_<key>` columns
          // on `er__<entity_id>`. Without this the wide-table statement
          // cache stays empty for those columns, the entity-data view in
          // `buildSessionViews` projects nothing, and the agent sees
          // `entity_record_create` fail or `sql_query` return empty
          // projections. Per-entity failures don't abort the result —
          // the field-mapping rows are already persisted; we just log
          // so the gap is visible.
          const affectedEntityIds = [
            ...new Set(items.map((item) => item.connectorEntityId)),
          ];
          for (const entityId of affectedEntityIds) {
            try {
              await wideTableReconcilerService.reconcileEntity(entityId);
            } catch (err) {
              logger.error(
                {
                  connectorEntityId: entityId,
                  error: err instanceof Error ? err.message : String(err),
                },
                "reconcileEntity failed after field_mapping_create"
              );
            }
          }

          return {
            success: true,
            operation: "created" as const,
            entity: "field mapping",
            count: results.length,
            items: items.map((item, idx) => ({
              entityId: results[idx].id,
              summary: {
                sourceField: item.sourceField,
                columnLabel: colDefMap.get(item.columnDefinitionId)?.label,
                isPrimaryKey: item.isPrimaryKey ?? false,
              },
            })),
          };
        } catch (err: unknown) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to create field mappings";
          return { error: message };
        }
      },
    });
  }
}

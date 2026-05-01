/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { FieldMappingModelFactory } from "@portalai/core/models";
import {
  assertStationScope,
  assertWriteCapability,
} from "../utils/resolve-capabilities.util.js";
import { Repository } from "../db/repositories/base.repository.js";

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
    .describe("A snake_case normalized key for the field"),
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

          // ── Phase 3: Cache ─────────────────────────────────────────
          const cacheRows = items.map((item, idx) => ({
            id: results[idx].id,
            connector_entity_id: item.connectorEntityId,
            column_definition_id: item.columnDefinitionId,
            source_field: item.sourceField,
            is_primary_key: item.isPrimaryKey ?? false,
          }));
          AnalyticsService.applyFieldMappingInsertMany(stationId, cacheRows);

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

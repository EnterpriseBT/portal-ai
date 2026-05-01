/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import {
  assertStationScope,
  assertWriteCapability,
} from "../utils/resolve-capabilities.util.js";
import { FieldMappingValidationService } from "../services/field-mapping-validation.service.js";

const ItemSchema = z.object({
  fieldMappingId: z.string().describe("The field mapping ID to delete"),
});

const InputSchema = z.object({
  items: z
    .array(ItemSchema)
    .min(1)
    .max(100)
    .describe("Field mappings to delete (1–100)"),
});

export class FieldMappingDeleteTool extends Tool<typeof InputSchema> {
  slug = "field_mapping_delete";
  name = "Field Mapping Delete Tool";
  description =
    "Deletes one or more field mappings and cascades to dependent group members. Accepts 1–100 items.";

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

          // ── Phase 1: Validate all before executing any ─────────────
          const failures: { index: number; error: string }[] = [];
          const mappings: Record<string, any> = {};

          for (let i = 0; i < items.length; i++) {
            const mapping = await DbService.repository.fieldMappings.findById(
              items[i].fieldMappingId
            );
            if (!mapping || mapping.organizationId !== organizationId) {
              failures.push({ index: i, error: "Field mapping not found" });
              continue;
            }
            mappings[items[i].fieldMappingId] = mapping;
          }

          if (failures.length > 0) {
            return {
              success: false,
              error: `${failures.length} of ${items.length} items failed validation`,
              failures,
            };
          }

          // Scope checks grouped by connectorEntityId
          const entityIds = [
            ...new Set(
              Object.values(mappings).map((m: any) => m.connectorEntityId)
            ),
          ];
          for (const entityId of entityIds) {
            try {
              await assertStationScope(stationId, entityId);
              await assertWriteCapability(entityId);
            } catch (err: any) {
              for (let i = 0; i < items.length; i++) {
                const m = mappings[items[i].fieldMappingId];
                if (m && m.connectorEntityId === entityId) {
                  failures.push({
                    index: i,
                    error: err.message ?? "Scope/capability check failed",
                  });
                }
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

          // Dependency validation for all items
          for (let i = 0; i < items.length; i++) {
            try {
              await FieldMappingValidationService.validateDelete(
                items[i].fieldMappingId
              );
            } catch (err: any) {
              failures.push({
                index: i,
                error: err.message ?? "Delete validation failed",
              });
            }
          }

          if (failures.length > 0) {
            return {
              success: false,
              error: `${failures.length} of ${items.length} items failed validation`,
              failures,
            };
          }

          // ── Phase 2: Execute sequentially (no wrapping transaction) ─
          const deleteResults: {
            cascadedEntityGroupMembers: number;
            counterpartCleared: boolean;
          }[] = [];
          for (const item of items) {
            const result = await FieldMappingValidationService.executeDelete(
              item.fieldMappingId,
              userId
            );
            deleteResults.push(result);
          }

          // ── Phase 3: Cache ─────────────────────────────────────────
          const ids = items.map((item) => item.fieldMappingId);
          AnalyticsService.applyFieldMappingDeleteMany(stationId, ids);

          return {
            success: true,
            operation: "deleted" as const,
            entity: "field mapping",
            count: items.length,
            items: items.map((item, idx) => ({
              entityId: item.fieldMappingId,
              summary: {
                sourceField: mappings[item.fieldMappingId]?.sourceField,
                cascaded: {
                  entityGroupMembers:
                    deleteResults[idx].cascadedEntityGroupMembers,
                  counterpartCleared: deleteResults[idx].counterpartCleared,
                },
              },
            })),
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to delete field mappings" };
        }
      },
    });
  }
}

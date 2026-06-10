/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import {
  assertStationScope,
  assertWriteCapability,
} from "../utils/resolve-capabilities.util.js";
import { Repository } from "../db/repositories/base.repository.js";
import { wideTableReconcilerService } from "../services/wide-table-reconciler.service.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "field-mapping-update-tool" });

const ItemSchema = z.object({
  fieldMappingId: z.string().describe("The field mapping ID to update"),
  sourceField: z.string().min(1).optional().describe("New source field name"),
  isPrimaryKey: z
    .boolean()
    .optional()
    .describe("Whether this mapping is a primary key"),
  normalizedKey: z
    .string()
    .regex(/^[a-z][a-z0-9_]*$/)
    .refine((s) => !/^c_/.test(s), {
      message:
        "normalizedKey must NOT start with `c_` — the system reserves that prefix for the physical wide-table column name and adds it automatically. Use the base name (e.g. `diameter_avg_km`).",
    })
    .optional()
    .describe(
      "Base snake_case key for this entity-column pair. **Do NOT prefix " +
        "with `c_`** — the system adds it when building the wide-table " +
        "column name (`c_<normalizedKey>`)."
    ),
  required: z
    .boolean()
    .optional()
    .describe("Whether this field is required for this source"),
  defaultValue: z
    .string()
    .nullable()
    .optional()
    .describe("Default fill value when source value is missing"),
  format: z
    .string()
    .nullable()
    .optional()
    .describe("Per-source parse format instructions"),
  enumValues: z
    .array(z.string())
    .nullable()
    .optional()
    .describe("Allowed values for this field"),
});

const InputSchema = z.object({
  items: z
    .array(ItemSchema)
    .min(1)
    .max(100)
    .describe("Field mappings to update (1–100)"),
});

export class FieldMappingUpdateTool extends Tool<typeof InputSchema> {
  slug = "field_mapping_update";
  name = "Field Mapping Update Tool";
  description =
    "Updates one or more field mappings' source field, primary key flag, normalizedKey, required, defaultValue, format, or enumValues. Accepts 1–100 items.";

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
          const mappings: Record<string, any> = {};

          // Load and validate each mapping
          for (let i = 0; i < items.length; i++) {
            const mapping = await DbService.repository.fieldMappings.findById(
              items[i].fieldMappingId
            );
            if (!mapping || mapping.organizationId !== organizationId) {
              failures.push({ index: i, error: "Field mapping not found" });
            } else {
              mappings[items[i].fieldMappingId] = mapping;
            }
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

          // ── Phase 2: Execute ───────────────────────────────────────
          await Repository.transaction(async (tx) => {
            for (const item of items) {
              const { fieldMappingId, ...fields } = item;
              const updateData: Record<string, unknown> = {
                updated: Date.now(),
                updatedBy: userId,
              };
              if (fields.sourceField !== undefined)
                updateData.sourceField = fields.sourceField;
              if (fields.isPrimaryKey !== undefined)
                updateData.isPrimaryKey = fields.isPrimaryKey;
              if (fields.normalizedKey !== undefined)
                updateData.normalizedKey = fields.normalizedKey;
              if (fields.required !== undefined)
                updateData.required = fields.required;
              if (fields.defaultValue !== undefined)
                updateData.defaultValue = fields.defaultValue;
              if (fields.format !== undefined)
                updateData.format = fields.format;
              if (fields.enumValues !== undefined)
                updateData.enumValues = fields.enumValues;

              await DbService.repository.fieldMappings.update(
                fieldMappingId,
                updateData as never,
                tx
              );
            }
          });

          // Reconcile each affected entity so renamed / retyped columns
          // appear on the wide table. Per-entity failures don't abort —
          // the update is already persisted.
          for (const entityId of entityIds) {
            try {
              await wideTableReconcilerService.reconcileEntity(entityId);
            } catch (err) {
              logger.error(
                {
                  connectorEntityId: entityId,
                  error: err instanceof Error ? err.message : String(err),
                },
                "reconcileEntity failed after field_mapping_update"
              );
            }
          }

          return {
            success: true,
            operation: "updated" as const,
            entity: "field mapping",
            count: items.length,
            items: items.map((item) => ({
              entityId: item.fieldMappingId,
              summary: {
                sourceField: mappings[item.fieldMappingId]?.sourceField,
              },
            })),
          };
        } catch (err: unknown) {
          const message =
            err instanceof Error
              ? err.message
              : "Failed to update field mappings";
          return { error: message };
        }
      },
    });
  }
}

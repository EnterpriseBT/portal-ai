import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";

const InputSchema = z.object({
  fieldMappingId: z.string().describe("The field mapping ID to update"),
  sourceField: z.string().min(1).optional().describe("New source field name"),
  isPrimaryKey: z.boolean().optional().describe("Whether this mapping is a primary key"),
  normalizedKey: z.string().regex(/^[a-z][a-z0-9_]*$/).optional().describe("Key used in normalizedData for this entity-column pair"),
  required: z.boolean().optional().describe("Whether this field is required for this source"),
  defaultValue: z.string().nullable().optional().describe("Default fill value when source value is missing"),
  format: z.string().nullable().optional().describe("Per-source parse format instructions"),
  enumValues: z.array(z.string()).nullable().optional().describe("Allowed values for this field"),
});

export class FieldMappingUpdateTool extends Tool<typeof InputSchema> {
  slug = "field_mapping_update";
  name = "Field Mapping Update Tool";
  description = "Updates a field mapping's source field, primary key flag, normalizedKey, required, defaultValue, format, or enumValues.";

  get schema() { return InputSchema; }

  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { fieldMappingId, ...fields } = this.validate(input);

          const mapping = await DbService.repository.fieldMappings.findById(fieldMappingId);
          if (!mapping || mapping.organizationId !== organizationId) {
            return { error: "Field mapping not found" };
          }

          await assertStationScope(stationId, mapping.connectorEntityId);
          await assertWriteCapability(mapping.connectorEntityId);

          const updateData: Record<string, unknown> = { updated: Date.now(), updatedBy: userId };
          if (fields.sourceField !== undefined) updateData.sourceField = fields.sourceField;
          if (fields.isPrimaryKey !== undefined) updateData.isPrimaryKey = fields.isPrimaryKey;
          if (fields.normalizedKey !== undefined) updateData.normalizedKey = fields.normalizedKey;
          if (fields.required !== undefined) updateData.required = fields.required;
          if (fields.defaultValue !== undefined) updateData.defaultValue = fields.defaultValue;
          if (fields.format !== undefined) updateData.format = fields.format;
          if (fields.enumValues !== undefined) updateData.enumValues = fields.enumValues;

          await DbService.repository.fieldMappings.update(fieldMappingId, updateData as never);
          AnalyticsService.applyFieldMappingUpdate(stationId, {
            id: fieldMappingId,
            connector_entity_id: mapping.connectorEntityId,
            column_definition_id: mapping.columnDefinitionId,
            source_field: (fields.sourceField ?? mapping.sourceField) as string,
            is_primary_key: (fields.isPrimaryKey ?? mapping.isPrimaryKey) as boolean,
          });          return {
            success: true,
            operation: "updated",
            entity: "field mapping",
            entityId: fieldMappingId,
            summary: { sourceField: mapping.sourceField, fields: Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined) },
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to update field mapping";
          return { error: message };
        }
      },
    });
  }
}

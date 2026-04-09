import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";
import { FieldMappingValidationService } from "../services/field-mapping-validation.service.js";

const InputSchema = z.object({
  fieldMappingId: z.string().describe("The field mapping ID to delete"),
});

export class FieldMappingDeleteTool extends Tool<typeof InputSchema> {
  slug = "field_mapping_delete";
  name = "Field Mapping Delete Tool";
  description = "Deletes a field mapping and cascades to dependent group members.";

  get schema() { return InputSchema; }

  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { fieldMappingId } = this.validate(input);

          const mapping = await DbService.repository.fieldMappings.findById(fieldMappingId);
          if (!mapping || mapping.organizationId !== organizationId) {
            return { error: "Field mapping not found" };
          }

          await assertStationScope(stationId, mapping.connectorEntityId);
          await assertWriteCapability(mapping.connectorEntityId);
          await FieldMappingValidationService.validateDelete(fieldMappingId);

          const result = await FieldMappingValidationService.executeDelete(fieldMappingId, userId);
          AnalyticsService.applyFieldMappingDelete(stationId, fieldMappingId);          return {
            success: true,
            operation: "deleted",
            entity: "field mapping",
            entityId: fieldMappingId,
            summary: {
              sourceField: mapping.sourceField,
              cascaded: {
                entityGroupMembers: result.cascadedEntityGroupMembers,
                counterpartCleared: result.counterpartCleared,
              },
            },
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to delete field mapping" };
        }
      },
    });
  }
}

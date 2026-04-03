import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";

const InputSchema = z.object({
  fieldMappingId: z.string().describe("The field mapping ID to update"),
  sourceField: z.string().min(1).optional().describe("New source field name"),
  isPrimaryKey: z.boolean().optional().describe("Whether this mapping is a primary key"),
});

export class FieldMappingUpdateTool extends Tool<typeof InputSchema> {
  slug = "field_mapping_update";
  name = "Field Mapping Update Tool";
  description = "Updates a field mapping's source field or primary key flag.";

  get schema() { return InputSchema; }

  build(stationId: string, organizationId: string, userId: string, onMutation?: () => void) {
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

          await DbService.repository.fieldMappings.update(fieldMappingId, updateData as never);
          onMutation?.();
          return { success: true, fieldMappingId };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to update field mapping";
          return { error: message };
        }
      },
    });
  }
}

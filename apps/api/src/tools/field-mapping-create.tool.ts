import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";

const InputSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity to create the mapping for"),
  columnDefinitionId: z.string().describe("The column definition to map to"),
  sourceField: z.string().min(1).describe("The source field name in the raw data"),
  isPrimaryKey: z.boolean().optional().describe("Whether this mapping is a primary key"),
});

export class FieldMappingCreateTool extends Tool<typeof InputSchema> {
  slug = "field_mapping_create";
  name = "Field Mapping Create Tool";
  description = "Creates or updates a field mapping between a source field and a column definition.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string, onMutation?: () => void) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { connectorEntityId, columnDefinitionId, sourceField, isPrimaryKey } = this.validate(input);
          await assertStationScope(stationId, connectorEntityId);
          await assertWriteCapability(connectorEntityId);

          const colDef = await DbService.repository.columnDefinitions.findById(columnDefinitionId);
          if (!colDef) {
            return { error: "Column definition not found" };
          }

          const entity = await DbService.repository.connectorEntities.findById(connectorEntityId);

          const result = await DbService.repository.fieldMappings.upsertByEntityAndColumn({
            connectorEntityId,
            columnDefinitionId,
            sourceField,
            isPrimaryKey: isPrimaryKey ?? false,
            organizationId: entity!.organizationId,
            createdBy: userId,
            created: Date.now(),
          } as any);

          onMutation?.();
          return { success: true, fieldMappingId: result.id };
        } catch (err: any) {
          return { error: err.message ?? "Failed to create field mapping" };
        }
      },
    });
  }
}

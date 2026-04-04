import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { FieldMappingModelFactory } from "@portalai/core/models";
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

  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { connectorEntityId, columnDefinitionId, sourceField, isPrimaryKey } = this.validate(input);
          await assertStationScope(stationId, connectorEntityId);
          await assertWriteCapability(connectorEntityId);

          const colDef = await DbService.repository.columnDefinitions.findById(columnDefinitionId);
          if (!colDef || colDef.organizationId !== organizationId) {
            return { error: "Column definition not found" };
          }

          const factory = new FieldMappingModelFactory();
          const model = factory.create(userId);
          model.update({
            organizationId,
            connectorEntityId,
            columnDefinitionId,
            sourceField,
            isPrimaryKey: isPrimaryKey ?? false,
            refColumnDefinitionId: null,
            refEntityKey: null,
            refBidirectionalFieldMappingId: null,
          });

          const result = await DbService.repository.fieldMappings.upsertByEntityAndColumn(model.parse());
          AnalyticsService.applyFieldMappingInsert(stationId, {
            id: result.id, connector_entity_id: connectorEntityId,
            column_definition_id: columnDefinitionId,
            source_field: sourceField, is_primary_key: isPrimaryKey ?? false,
          });          return {
            success: true,
            operation: "created",
            entity: "field mapping",
            entityId: result.id,
            summary: { sourceField, columnLabel: colDef.label, isPrimaryKey: isPrimaryKey ?? false },
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to create field mapping";
          return { error: message };
        }
      },
    });
  }
}

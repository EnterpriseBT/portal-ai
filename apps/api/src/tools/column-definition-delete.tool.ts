import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { ColumnDefinitionValidationService } from "../services/column-definition-validation.service.js";

const InputSchema = z.object({
  columnDefinitionId: z.string().describe("The column definition ID to delete"),
});

export class ColumnDefinitionDeleteTool extends Tool<typeof InputSchema> {
  slug = "column_definition_delete";
  name = "Column Definition Delete Tool";
  description = "Deletes a column definition if no field mappings reference it.";

  get schema() { return InputSchema; }

  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { columnDefinitionId } = this.validate(input);

          const existing = await DbService.repository.columnDefinitions.findById(columnDefinitionId);
          if (!existing || existing.organizationId !== organizationId) {
            return { error: "Column definition not found" };
          }

          await ColumnDefinitionValidationService.validateDelete(columnDefinitionId);
          await DbService.repository.columnDefinitions.softDelete(columnDefinitionId, userId);
          AnalyticsService.applyColumnDefinitionDelete(stationId, columnDefinitionId);          return {
            success: true,
            operation: "deleted",
            entity: "column definition",
            entityId: columnDefinitionId,
            summary: { key: existing.key, label: existing.label },
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to delete column definition" };
        }
      },
    });
  }
}

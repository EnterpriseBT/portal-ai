import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";

const InputSchema = z.object({
  columnDefinitionId: z.string().describe("The column definition ID to update"),
  label: z.string().min(1).optional().describe("New display label"),
  description: z.string().nullable().optional().describe("New description"),
  enumValues: z.array(z.string()).nullable().optional().describe("New enum values"),
});

export class ColumnDefinitionUpdateTool extends Tool<typeof InputSchema> {
  slug = "column_definition_update";
  name = "Column Definition Update Tool";
  description = "Updates a column definition's label, description, or enum values. Key and type are immutable.";

  get schema() { return InputSchema; }

  build(organizationId: string, userId: string, onMutation?: () => void | Promise<void>) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { columnDefinitionId, ...fields } = this.validate(input);

          const existing = await DbService.repository.columnDefinitions.findById(columnDefinitionId);
          if (!existing || existing.organizationId !== organizationId) {
            return { error: "Column definition not found" };
          }

          const updateData: Record<string, unknown> = { updated: Date.now(), updatedBy: userId };
          if (fields.label !== undefined) updateData.label = fields.label;
          if (fields.description !== undefined) updateData.description = fields.description;
          if (fields.enumValues !== undefined) updateData.enumValues = fields.enumValues;

          await DbService.repository.columnDefinitions.update(columnDefinitionId, updateData as any);
          await onMutation?.();
          return {
            success: true,
            operation: "updated",
            entity: "column definition",
            entityId: columnDefinitionId,
            summary: { label: existing.label, fields: Object.keys(fields).filter((k) => (fields as Record<string, unknown>)[k] !== undefined) },
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to update column definition" };
        }
      },
    });
  }
}

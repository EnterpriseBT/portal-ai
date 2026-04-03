import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";

const InputSchema = z.object({
  organizationId: z.string().describe("The organization ID"),
  key: z.string().min(1).describe("Unique key for the column definition"),
  label: z.string().min(1).describe("Display label"),
  type: z.string().min(1).describe("Column data type (e.g. text, number, boolean)"),
  required: z.boolean().optional().describe("Whether the column is required"),
  enumValues: z.array(z.string()).optional().describe("Allowed values for enum columns"),
  description: z.string().optional().describe("Column description"),
});

export class ColumnDefinitionCreateTool extends Tool<typeof InputSchema> {
  slug = "column_definition_create";
  name = "Column Definition Create Tool";
  description = "Creates or updates a column definition by key. Organization-level — no station scope required.";

  get schema() { return InputSchema; }

  build(organizationId: string, userId: string, onMutation?: () => void) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const validated = this.validate(input);

          const result = await DbService.repository.columnDefinitions.upsertByKey({
            organizationId,
            key: validated.key,
            label: validated.label,
            type: validated.type,
            required: validated.required ?? false,
            enumValues: validated.enumValues ?? null,
            description: validated.description ?? null,
            createdBy: userId,
            created: Date.now(),
          } as any);

          onMutation?.();
          return { success: true, columnDefinitionId: result.id };
        } catch (err: any) {
          return { error: err.message ?? "Failed to create column definition" };
        }
      },
    });
  }
}

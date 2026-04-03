import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { ColumnDefinitionModelFactory, ColumnDataTypeEnum } from "@portalai/core/models";

const InputSchema = z.object({
  key: z.string().min(1).describe("Unique key for the column definition"),
  label: z.string().min(1).describe("Display label"),
  type: ColumnDataTypeEnum.describe("Column data type (string, number, boolean, date, datetime, enum, json, array, currency)"),
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

          const factory = new ColumnDefinitionModelFactory();
          const model = factory.create(userId);
          model.update({
            organizationId,
            key: validated.key,
            label: validated.label,
            type: validated.type,
            required: validated.required ?? false,
            defaultValue: null,
            format: null,
            enumValues: validated.enumValues ?? null,
            description: validated.description ?? null,
          });

          const result = await DbService.repository.columnDefinitions.upsertByKey(model.parse());
          onMutation?.();
          return { success: true, columnDefinitionId: result.id };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to create column definition";
          return { error: message };
        }
      },
    });
  }
}

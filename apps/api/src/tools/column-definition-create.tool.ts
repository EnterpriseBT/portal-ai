import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { ColumnDefinitionModelFactory, ColumnDataTypeEnum } from "@portalai/core/models";

const InputSchema = z.object({
  key: z.string().min(1).describe("Unique key for the column definition"),
  label: z.string().min(1).describe("Display label"),
  type: ColumnDataTypeEnum.describe("Column data type (string, number, boolean, date, datetime, enum, json, array, reference, reference-array)"),
  description: z.string().optional().describe("Column description"),
  validationPattern: z.string().optional().describe("Regex validation pattern for column values"),
  validationMessage: z.string().optional().describe("Error message when validation fails"),
  canonicalFormat: z.string().optional().describe("Canonical display format (e.g. $#,##0.00)"),
});

export class ColumnDefinitionCreateTool extends Tool<typeof InputSchema> {
  slug = "column_definition_create";
  name = "Column Definition Create Tool";
  description = "Creates or updates a column definition by key. Organization-level — no station scope required.";

  get schema() { return InputSchema; }

  build(stationId: string, organizationId: string, userId: string) {
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
            description: validated.description ?? null,
            validationPattern: validated.validationPattern ?? null,
            validationMessage: validated.validationMessage ?? null,
            canonicalFormat: validated.canonicalFormat ?? null,
          });

          const result = await DbService.repository.columnDefinitions.upsertByKey(model.parse());
          AnalyticsService.applyColumnDefinitionInsert(stationId, {
            id: result.id, key: validated.key, label: validated.label,
            type: validated.type,
            description: validated.description ?? null,
          });          return {
            success: true,
            operation: "created",
            entity: "column definition",
            entityId: result.id,
            summary: { key: validated.key, label: validated.label, type: validated.type },
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to create column definition";
          return { error: message };
        }
      },
    });
  }
}

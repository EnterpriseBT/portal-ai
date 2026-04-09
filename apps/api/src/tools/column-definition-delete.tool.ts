import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { ColumnDefinitionValidationService } from "../services/column-definition-validation.service.js";
import { Repository } from "../db/repositories/base.repository.js";

const ItemSchema = z.object({
  columnDefinitionId: z.string().describe("The column definition ID to delete"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Column definitions to delete (1–100)"),
});

export class ColumnDefinitionDeleteTool extends Tool<typeof InputSchema> {
  slug = "column_definition_delete";
  name = "Column Definition Delete Tool";
  description = "Deletes one or more column definitions if no field mappings reference them. Accepts 1–100 items.";

  get schema() { return InputSchema; }

  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { items } = this.validate(input);

          // ── Phase 1: Validate ──────────────────────────────────────
          const failures: { index: number; error: string }[] = [];
          const existingDefs: Record<string, any> = {};

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const existing = await DbService.repository.columnDefinitions.findById(item.columnDefinitionId);
            if (!existing || existing.organizationId !== organizationId) {
              failures.push({ index: i, error: "Column definition not found" });
              continue;
            }
            existingDefs[item.columnDefinitionId] = existing;

            try {
              await ColumnDefinitionValidationService.validateDelete(item.columnDefinitionId);
            } catch (err: any) {
              failures.push({ index: i, error: err.message ?? "Delete validation failed" });
            }
          }

          if (failures.length > 0) {
            return { success: false, error: `${failures.length} of ${items.length} items failed validation`, failures };
          }

          // ── Phase 2: Execute ───────────────────────────────────────
          await Repository.transaction(async (tx) => {
            for (const item of items) {
              await DbService.repository.columnDefinitions.softDelete(item.columnDefinitionId, userId, tx);
            }
          });

          // ── Phase 3: Cache ─────────────────────────────────────────
          const ids = items.map((item) => item.columnDefinitionId);
          AnalyticsService.applyColumnDefinitionDeleteMany(stationId, ids);

          return {
            success: true,
            operation: "deleted" as const,
            entity: "column definition",
            count: items.length,
            items: items.map((item) => ({
              entityId: item.columnDefinitionId,
              summary: { key: existingDefs[item.columnDefinitionId]?.key, label: existingDefs[item.columnDefinitionId]?.label },
            })),
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to delete column definitions" };
        }
      },
    });
  }
}

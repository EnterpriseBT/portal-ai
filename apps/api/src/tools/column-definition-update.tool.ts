import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { Repository } from "../db/repositories/base.repository.js";

const ItemSchema = z.object({
  columnDefinitionId: z.string().describe("The column definition ID to update"),
  label: z.string().min(1).optional().describe("New display label"),
  description: z.string().nullable().optional().describe("New description"),
  validationPattern: z.string().nullable().optional().describe("New regex validation pattern"),
  validationMessage: z.string().nullable().optional().describe("New validation error message"),
  canonicalFormat: z.string().nullable().optional().describe("New canonical display format"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Column definitions to update (1–100)"),
});

export class ColumnDefinitionUpdateTool extends Tool<typeof InputSchema> {
  slug = "column_definition_update";
  name = "Column Definition Update Tool";
  description = "Updates one or more column definitions' label, description, or validation fields. Key and type are immutable. Accepts 1–100 items.";

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
            } else {
              existingDefs[item.columnDefinitionId] = existing;
            }
          }

          if (failures.length > 0) {
            return { success: false, error: `${failures.length} of ${items.length} items failed validation`, failures };
          }

          // ── Phase 2: Execute ───────────────────────────────────────
          await Repository.transaction(async (tx) => {
            for (const item of items) {
              const { columnDefinitionId, ...fields } = item;
              const updateData: Record<string, unknown> = { updated: Date.now(), updatedBy: userId };
              if (fields.label !== undefined) updateData.label = fields.label;
              if (fields.description !== undefined) updateData.description = fields.description;
              if (fields.validationPattern !== undefined) updateData.validationPattern = fields.validationPattern;
              if (fields.validationMessage !== undefined) updateData.validationMessage = fields.validationMessage;
              if (fields.canonicalFormat !== undefined) updateData.canonicalFormat = fields.canonicalFormat;

              await DbService.repository.columnDefinitions.update(columnDefinitionId, updateData as any, tx);
            }
          });

          // ── Phase 3: Cache ─────────────────────────────────────────
          const cacheRows = items.map((item) => {
            const existing = existingDefs[item.columnDefinitionId];
            return {
              id: item.columnDefinitionId,
              key: existing.key,
              label: (item.label ?? existing.label) as string,
              type: existing.type as string,
              description: (item.description !== undefined ? item.description : existing.description) as string | null,
            };
          });
          AnalyticsService.applyColumnDefinitionUpdateMany(stationId, cacheRows);

          return {
            success: true,
            operation: "updated" as const,
            entity: "column definition",
            count: items.length,
            items: items.map((item) => ({
              entityId: item.columnDefinitionId,
              summary: { label: existingDefs[item.columnDefinitionId]?.label },
            })),
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to update column definitions" };
        }
      },
    });
  }
}

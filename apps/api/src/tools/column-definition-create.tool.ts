import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { ColumnDefinitionModelFactory, ColumnDataTypeEnum } from "@portalai/core/models";
import { Repository } from "../db/repositories/base.repository.js";

const ItemSchema = z.object({
  key: z.string().min(1).describe("Unique key for the column definition"),
  label: z.string().min(1).describe("Display label"),
  type: ColumnDataTypeEnum.describe("Column data type (string, number, boolean, date, datetime, enum, json, array, reference, reference-array)"),
  description: z.string().optional().describe("Column description"),
  validationPattern: z.string().optional().describe("Regex validation pattern for column values"),
  validationMessage: z.string().optional().describe("Error message when validation fails"),
  canonicalFormat: z.string().optional().describe("Canonical display format (e.g. $#,##0.00)"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Column definitions to create (1–100)"),
});

export class ColumnDefinitionCreateTool extends Tool<typeof InputSchema> {
  slug = "column_definition_create";
  name = "Column Definition Create Tool";
  description = "Creates or reuses column definitions by key. Prioritizes existing definitions when key and type match. Accepts 1–100 items.";

  get schema() { return InputSchema; }

  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { items } = this.validate(input);

          // ── Within-batch dedup: last occurrence per key wins ────────
          const dedupMap = new Map<string, { item: (typeof items)[0]; originalIndex: number }>();
          for (let i = 0; i < items.length; i++) {
            dedupMap.set(items[i].key, { item: items[i], originalIndex: i });
          }
          const dedupedItems = [...dedupMap.values()].map((v) => v.item);

          // ── Load existing definitions for reuse check ──────────────
          const existing = await DbService.repository.columnDefinitions.findByOrganizationId(organizationId);
          const existingByKey = new Map(existing.map((d: any) => [d.key, d]));

          // ── Classify: reuse vs. create ─────────────────────────────
          type ResultItem = { entityId: string; summary: { key: string; label: string; type: string; status: "reused" | "created" } };
          const resultItems: ResultItem[] = [];
          const toUpsert: (typeof dedupedItems[0])[] = [];

          for (const item of dedupedItems) {
            const ex = existingByKey.get(item.key);
            if (ex && ex.type === item.type) {
              // Reuse — key+type match
              resultItems.push({
                entityId: ex.id,
                summary: { key: item.key, label: ex.label, type: item.type, status: "reused" },
              });
            } else {
              toUpsert.push(item);
            }
          }

          // ── Persist new/updated definitions in a transaction ───────
          const factory = new ColumnDefinitionModelFactory();
          const createdRows: { id: string; key: string; label: string; type: string; description: string | null }[] = [];

          if (toUpsert.length > 0) {
            await Repository.transaction(async (tx) => {
              for (const item of toUpsert) {
                const model = factory.create(userId);
                model.update({
                  organizationId,
                  key: item.key,
                  label: item.label,
                  type: item.type,
                  description: item.description ?? null,
                  validationPattern: item.validationPattern ?? null,
                  validationMessage: item.validationMessage ?? null,
                  canonicalFormat: item.canonicalFormat ?? null,
                });
                const result = await DbService.repository.columnDefinitions.upsertByKey(model.parse(), tx);
                createdRows.push({ id: result.id, key: item.key, label: item.label, type: item.type, description: item.description ?? null });
                resultItems.push({
                  entityId: result.id,
                  summary: { key: item.key, label: item.label, type: item.type, status: "created" },
                });
              }
            });
          }

          // ── Cache update ───────────────────────────────────────────
          if (createdRows.length > 0) {
            AnalyticsService.applyColumnDefinitionInsertMany(stationId, createdRows);
          }

          const reusedCount = dedupedItems.length - toUpsert.length;

          return {
            success: true,
            operation: "created" as const,
            entity: "column definition",
            count: dedupedItems.length,
            reused: reusedCount,
            created: toUpsert.length,
            items: resultItems,
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to create column definitions";
          return { error: message };
        }
      },
    });
  }
}

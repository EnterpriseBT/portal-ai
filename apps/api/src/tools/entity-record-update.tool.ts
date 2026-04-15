import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";
import { NormalizationService } from "../services/normalization.service.js";
import { Repository } from "../db/repositories/base.repository.js";

const ItemSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity the record belongs to"),
  entityRecordId: z.string().describe("The record ID to update"),
  data: z.record(z.string(), z.unknown()).describe("Updated record data keyed by `normalizedKey` from the entity's field mappings"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Records to update (1–100)"),
});

export class EntityRecordUpdateTool extends Tool<typeof InputSchema> {
  slug = "entity_record_update";
  name = "Entity Record Update Tool";
  description = "Updates one or more entity records' data and normalized data. Accepts 1–100 items.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { items } = this.validate(input);

          // ── Phase 1: Validate ──────────────────────────────────────
          const groups = new Map<string, typeof items>();
          for (const item of items) {
            const group = groups.get(item.connectorEntityId) ?? [];
            group.push(item);
            groups.set(item.connectorEntityId, group);
          }

          const failures: { index: number; error: string }[] = [];

          // Scope checks once per entity
          for (const connectorEntityId of groups.keys()) {
            try {
              await assertStationScope(stationId, connectorEntityId);
              await assertWriteCapability(connectorEntityId);
            } catch (err: any) {
              const groupItems = groups.get(connectorEntityId)!;
              for (const item of groupItems) {
                failures.push({ index: items.indexOf(item), error: err.message ?? "Scope/capability check failed" });
              }
            }
          }

          if (failures.length > 0) {
            return { success: false, error: `${failures.length} of ${items.length} items failed validation`, failures };
          }

          // Verify each record exists and belongs to its entity, and capture
          // the existing raw `data` so partial updates are merged (not replaced).
          // `data` and `normalizedData` are JSONB columns — writing them
          // replaces the entire blob, so we must merge with the existing value.
          const existingDataByIndex = new Array<Record<string, unknown>>(items.length);
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const existing = await DbService.repository.entityRecords.findById(item.entityRecordId);
            if (!existing || existing.connectorEntityId !== item.connectorEntityId) {
              failures.push({ index: i, error: "Record not found or does not belong to entity" });
            } else {
              existingDataByIndex[i] = (existing.data ?? {}) as Record<string, unknown>;
            }
          }

          if (failures.length > 0) {
            return { success: false, error: `${failures.length} of ${items.length} items failed validation`, failures };
          }

          // Merge partial updates over existing raw data so the full record is
          // re-normalized (otherwise absent fields would be coerced to null).
          const mergedDataByIndex = items.map(
            (item, idx) => ({ ...existingDataByIndex[idx], ...item.data }),
          );

          // Normalize per group using the merged data
          type NormResult = { normalizedData: Record<string, unknown>; validationErrors: any; isValid: boolean };
          const normResults: NormResult[] = new Array(items.length);

          for (const [connectorEntityId, groupItems] of groups) {
            const dataArray = groupItems.map((item) => mergedDataByIndex[items.indexOf(item)]);
            const results = await NormalizationService.normalizeMany(connectorEntityId, dataArray);
            for (let i = 0; i < groupItems.length; i++) {
              normResults[items.indexOf(groupItems[i])] = results[i] as NormResult;
            }
          }

          // ── Phase 2: Execute ───────────────────────────────────────
          const payloads = items.map((item, idx) => {
            const norm = normResults[idx];
            return {
              id: item.entityRecordId,
              data: {
                data: mergedDataByIndex[idx],
                normalizedData: norm.normalizedData,
                validationErrors: norm.validationErrors,
                isValid: norm.isValid,
                updated: Date.now(),
                updatedBy: userId,
              },
            };
          });

          const updated = await Repository.transaction(async (tx) => {
            return DbService.repository.entityRecords.updateMany(payloads, tx);
          });

          // ── Phase 3: Cache ─────────────────────────────────────────
          for (const [connectorEntityId, groupItems] of groups) {
            const entity = await DbService.repository.connectorEntities.findById(connectorEntityId);
            if (!entity) continue;
            const rows = groupItems.map((item) => {
              const idx = items.indexOf(item);
              const norm = normResults[idx];
              return {
                _record_id: item.entityRecordId,
                _connector_entity_id: connectorEntityId,
                ...norm.normalizedData,
              };
            });
            AnalyticsService.applyRecordUpdateMany(stationId, (entity as any).key, rows);
          }

          return {
            success: true,
            operation: "updated" as const,
            entity: "record",
            count: updated.length,
            items: items.map((item) => ({
              entityId: item.entityRecordId,
              summary: { fields: Object.keys(item.data) },
            })),
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to update records" };
        }
      },
    });
  }
}

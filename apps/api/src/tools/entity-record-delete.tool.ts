import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import {
  assertStationScope,
  assertWriteCapability,
} from "../utils/resolve-capabilities.util.js";
import { Repository } from "../db/repositories/base.repository.js";

const ItemSchema = z.object({
  connectorEntityId: z
    .string()
    .describe("The connector entity the record belongs to"),
  entityRecordId: z.string().describe("The record ID to delete"),
});

const InputSchema = z.object({
  items: z
    .array(ItemSchema)
    .min(1)
    .max(100)
    .describe("Records to delete (1–100)"),
});

export class EntityRecordDeleteTool extends Tool<typeof InputSchema> {
  slug = "entity_record_delete";
  name = "Entity Record Delete Tool";
  description = "Soft-deletes one or more entity records. Accepts 1–100 items.";

  get schema() {
    return InputSchema;
  }

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

          for (const connectorEntityId of groups.keys()) {
            try {
              await assertStationScope(stationId, connectorEntityId);
              await assertWriteCapability(connectorEntityId);
            } catch (err: any) {
              const groupItems = groups.get(connectorEntityId)!;
              for (const item of groupItems) {
                failures.push({
                  index: items.indexOf(item),
                  error: err.message ?? "Scope/capability check failed",
                });
              }
            }
          }

          if (failures.length > 0) {
            return {
              success: false,
              error: `${failures.length} of ${items.length} items failed validation`,
              failures,
            };
          }

          // Verify each record exists and belongs to its entity
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const existing = await DbService.repository.entityRecords.findById(
              item.entityRecordId
            );
            if (
              !existing ||
              existing.connectorEntityId !== item.connectorEntityId
            ) {
              failures.push({
                index: i,
                error: "Record not found or does not belong to entity",
              });
            }
          }

          if (failures.length > 0) {
            return {
              success: false,
              error: `${failures.length} of ${items.length} items failed validation`,
              failures,
            };
          }

          // ── Phase 2: Execute ───────────────────────────────────────
          const allIds = items.map((item) => item.entityRecordId);

          await Repository.transaction(async (tx) => {
            await DbService.repository.entityRecords.softDeleteMany(
              allIds,
              userId,
              tx
            );
          });

          // ── Phase 3: Cache ─────────────────────────────────────────
          for (const [connectorEntityId, groupItems] of groups) {
            const entity =
              await DbService.repository.connectorEntities.findById(
                connectorEntityId
              );
            if (!entity) continue;
            const recordIds = groupItems.map((item) => item.entityRecordId);
            AnalyticsService.applyRecordDeleteMany(
              stationId,
              (entity as any).key,
              recordIds
            );
          }

          return {
            success: true,
            operation: "deleted" as const,
            entity: "record",
            count: items.length,
            items: items.map((item) => ({
              entityId: item.entityRecordId,
            })),
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to delete records" };
        }
      },
    });
  }
}

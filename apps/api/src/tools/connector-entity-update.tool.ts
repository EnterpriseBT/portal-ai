import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";
import { Repository } from "../db/repositories/base.repository.js";

const ItemSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity ID to update"),
  label: z.string().min(1).describe("New label for the entity"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Connector entities to update (1–100)"),
});

export class ConnectorEntityUpdateTool extends Tool<typeof InputSchema> {
  slug = "connector_entity_update";
  name = "Connector Entity Update Tool";
  description = "Updates one or more connector entities' labels. Accepts 1–100 items.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { items } = this.validate(input);

          // ── Phase 1: Validate ──────────────────────────────────────
          const failures: { index: number; error: string }[] = [];
          const entities: Record<string, any> = {};

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            try {
              await assertStationScope(stationId, item.connectorEntityId);
              await assertWriteCapability(item.connectorEntityId);
            } catch (err: any) {
              failures.push({ index: i, error: err.message ?? "Scope/capability check failed" });
              continue;
            }

            const existing = await DbService.repository.connectorEntities.findById(item.connectorEntityId);
            if (!existing) {
              failures.push({ index: i, error: "Connector entity not found" });
              continue;
            }
            entities[item.connectorEntityId] = existing;
          }

          if (failures.length > 0) {
            return { success: false, error: `${failures.length} of ${items.length} items failed validation`, failures };
          }

          // ── Phase 2: Execute ───────────────────────────────────────
          await Repository.transaction(async (tx) => {
            for (const item of items) {
              await DbService.repository.connectorEntities.update(item.connectorEntityId, {
                label: item.label,
                updated: Date.now(),
                updatedBy: userId,
              } as any, tx);
            }
          });

          // ── Phase 3: Cache ─────────────────────────────────────────
          const cacheRows = items.map((item) => {
            const existing = entities[item.connectorEntityId];
            return {
              id: item.connectorEntityId,
              key: existing.key,
              label: item.label,
              connectorInstanceId: existing.connectorInstanceId,
            };
          });
          AnalyticsService.applyEntityUpdateMany(stationId, cacheRows);

          return {
            success: true,
            operation: "updated" as const,
            entity: "connector entity",
            count: items.length,
            items: items.map((item) => ({
              entityId: item.connectorEntityId,
              summary: { label: item.label },
            })),
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to update entities" };
        }
      },
    });
  }
}

import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { assertStationScope } from "../utils/resolve-capabilities.util.js";
import { ConnectorEntityValidationService } from "../services/connector-entity-validation.service.js";

const ItemSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity ID to delete"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Connector entities to delete (1–100)"),
});

export class ConnectorEntityDeleteTool extends Tool<typeof InputSchema> {
  slug = "connector_entity_delete";
  name = "Connector Entity Delete Tool";
  description = "Deletes one or more connector entities and all dependent records, field mappings, tags, and group memberships. Accepts 1–100 items.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { items } = this.validate(input);

          // ── Phase 1: Validate all before executing any ─────────────
          const failures: { index: number; error: string }[] = [];
          const entities: Record<string, any> = {};

          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            try {
              await assertStationScope(stationId, item.connectorEntityId);
            } catch (err: any) {
              failures.push({ index: i, error: err.message ?? "Scope check failed" });
              continue;
            }

            const entity = await DbService.repository.connectorEntities.findById(item.connectorEntityId);
            if (entity) entities[item.connectorEntityId] = entity;

            try {
              await ConnectorEntityValidationService.validateDelete(item.connectorEntityId);
            } catch (err: any) {
              failures.push({ index: i, error: err.message ?? "Delete validation failed" });
            }
          }

          if (failures.length > 0) {
            return { success: false, error: `${failures.length} of ${items.length} items failed validation`, failures };
          }

          // ── Phase 2: Execute sequentially (no wrapping tx) ─────────
          const cascadedResults: any[] = [];
          for (const item of items) {
            const cascaded = await ConnectorEntityValidationService.executeDelete(item.connectorEntityId, userId);
            cascadedResults.push(cascaded);
          }

          // ── Phase 3: Cache ─────────────────────────────────────────
          const entityIds = items.map((item) => item.connectorEntityId);
          const entityKeys = items.map((item) => entities[item.connectorEntityId]?.key).filter(Boolean);
          AnalyticsService.applyEntityDeleteMany(stationId, entityIds, entityKeys);

          return {
            success: true,
            operation: "deleted" as const,
            entity: "connector entity",
            count: items.length,
            items: items.map((item, idx) => ({
              entityId: item.connectorEntityId,
              summary: {
                label: entities[item.connectorEntityId]?.label ?? item.connectorEntityId,
                cascaded: cascadedResults[idx],
              },
            })),
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to delete entities" };
        }
      },
    });
  }
}

import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";

const InputSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity ID to update"),
  label: z.string().min(1).describe("New label for the entity"),
});

export class ConnectorEntityUpdateTool extends Tool<typeof InputSchema> {
  slug = "connector_entity_update";
  name = "Connector Entity Update Tool";
  description = "Updates a connector entity's label.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { connectorEntityId, label } = this.validate(input);
          await assertStationScope(stationId, connectorEntityId);
          await assertWriteCapability(connectorEntityId);

          const existing = await DbService.repository.connectorEntities.findById(connectorEntityId);
          if (!existing) {
            return { error: "Connector entity not found" };
          }

          await DbService.repository.connectorEntities.update(connectorEntityId, {
            label,
            updated: Date.now(),
            updatedBy: userId,
          } as any);

          AnalyticsService.applyEntityUpdate(stationId, {
            id: connectorEntityId, key: existing.key, label, connectorInstanceId: existing.connectorInstanceId,
          });          return {
            success: true,
            operation: "updated",
            entity: "connector entity",
            entityId: connectorEntityId,
            summary: { label },
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to update entity" };
        }
      },
    });
  }
}

import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { stationInstancesRepo } from "../db/repositories/station-instances.repository.js";
import { connectorDefinitionsRepo } from "../db/repositories/connector-definitions.repository.js";
import { resolveCapabilities } from "../utils/resolve-capabilities.util.js";

const InputSchema = z.object({
  connectorInstanceId: z.string().describe("The connector instance to create the entity under"),
  key: z.string().min(1).describe("Unique key for the entity (used as AlaSQL table name)"),
  label: z.string().min(1).describe("Human-readable label"),
});

export class ConnectorEntityCreateTool extends Tool<typeof InputSchema> {
  slug = "connector_entity_create";
  name = "Connector Entity Create Tool";
  description = "Creates a new connector entity under an attached connector instance.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string, onMutation?: () => void) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { connectorInstanceId, key, label } = this.validate(input);

          // Verify the instance is attached to this station
          const stationLinks = await stationInstancesRepo.findByStationId(stationId);
          const attachedIds = new Set(stationLinks.map((l) => l.connectorInstanceId));
          if (!attachedIds.has(connectorInstanceId)) {
            return { error: "Connector instance is not attached to this station" };
          }

          const instance = await DbService.repository.connectorInstances.findById(connectorInstanceId);
          if (!instance) {
            return { error: "Connector instance not found" };
          }

          const definition = await connectorDefinitionsRepo.findById(instance.connectorDefinitionId);
          if (!definition) {
            return { error: "Connector definition not found" };
          }

          const capabilities = resolveCapabilities(definition, instance);
          if (!capabilities.write) {
            return { error: "Cannot create entity — the connector instance does not have write capability enabled" };
          }

          const result = await DbService.repository.connectorEntities.upsertByKey({
            organizationId: instance.organizationId,
            connectorInstanceId,
            key,
            label,
            createdBy: userId,
            created: Date.now(),
          } as never);

          onMutation?.();
          return { success: true, connectorEntityId: result.id };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to create entity";
          return { error: message };
        }
      },
    });
  }
}

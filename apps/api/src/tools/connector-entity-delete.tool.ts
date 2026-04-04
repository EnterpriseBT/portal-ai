import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { assertStationScope } from "../utils/resolve-capabilities.util.js";
import { ConnectorEntityValidationService } from "../services/connector-entity-validation.service.js";

const InputSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity ID to delete"),
});

export class ConnectorEntityDeleteTool extends Tool<typeof InputSchema> {
  slug = "connector_entity_delete";
  name = "Connector Entity Delete Tool";
  description = "Deletes a connector entity and all its dependent records, field mappings, tags, and group memberships.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string, onMutation?: () => void | Promise<void>) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { connectorEntityId } = this.validate(input);
          await assertStationScope(stationId, connectorEntityId);
          await ConnectorEntityValidationService.validateDelete(connectorEntityId);

          const entity = await DbService.repository.connectorEntities.findById(connectorEntityId);
          const cascaded = await ConnectorEntityValidationService.executeDelete(connectorEntityId, userId);
          await onMutation?.();
          return {
            success: true,
            operation: "deleted",
            entity: "connector entity",
            entityId: connectorEntityId,
            summary: { label: entity?.label ?? connectorEntityId, cascaded },
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to delete entity" };
        }
      },
    });
  }
}

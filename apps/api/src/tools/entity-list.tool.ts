import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { stationInstancesRepo } from "../db/repositories/station-instances.repository.js";
import { connectorEntitiesRepo } from "../db/repositories/connector-entities.repository.js";

const InputSchema = z.object({
  connectorInstanceId: z
    .string()
    .optional()
    .describe("Optional connector instance ID to filter entities by"),
});

export class EntityListTool extends Tool<typeof InputSchema> {
  slug = "entity_list";
  name = "Entity List Tool";
  description =
    "Lists all connector entities attached to the current station. " +
    "Optionally filters by a specific connector instance.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { connectorInstanceId } = this.validate(input);

        const stationLinks =
          await stationInstancesRepo.findByStationId(stationId);
        const attachedInstanceIds = new Set(
          stationLinks.map((l) => l.connectorInstanceId),
        );

        // Load entities for each attached instance
        const allEntities = (
          await Promise.all(
            [...attachedInstanceIds].map((id) =>
              connectorEntitiesRepo.findByConnectorInstanceId(id),
            ),
          )
        ).flat();

        // Optionally filter by connectorInstanceId
        const filtered = connectorInstanceId
          ? allEntities.filter(
              (e) => e.connectorInstanceId === connectorInstanceId,
            )
          : allEntities;

        return {
          entities: filtered.map((e) => ({
            id: e.id,
            key: e.key,
            label: e.label,
            connectorInstanceId: e.connectorInstanceId,
          })),
        };
      },
    });
  }
}

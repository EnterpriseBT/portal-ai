import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";
import { NormalizationService } from "../services/normalization.service.js";

const InputSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity the record belongs to"),
  entityRecordId: z.string().describe("The record ID to update"),
  data: z.record(z.string(), z.unknown()).describe("Updated record data keyed by source field names"),
});

export class EntityRecordUpdateTool extends Tool<typeof InputSchema> {
  slug = "entity_record_update";
  name = "Entity Record Update Tool";
  description = "Updates an existing entity record's data and normalized data.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string, onMutation?: () => void) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { connectorEntityId, entityRecordId, data } = this.validate(input);
          await assertStationScope(stationId, connectorEntityId);
          await assertWriteCapability(connectorEntityId);

          const existing = await DbService.repository.entityRecords.findById(entityRecordId);
          if (!existing || existing.connectorEntityId !== connectorEntityId) {
            return { error: "Record not found or does not belong to entity" };
          }

          const normalizedData = await NormalizationService.normalize(connectorEntityId, data);

          await DbService.repository.entityRecords.update(entityRecordId, {
            data,
            normalizedData,
            updated: Date.now(),
            updatedBy: userId,
          } as any);

          onMutation?.();
          return { success: true, recordId: entityRecordId };
        } catch (err: any) {
          return { error: err.message ?? "Failed to update record" };
        }
      },
    });
  }
}

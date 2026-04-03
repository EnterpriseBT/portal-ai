import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";

const InputSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity the record belongs to"),
  entityRecordId: z.string().describe("The record ID to delete"),
});

export class EntityRecordDeleteTool extends Tool<typeof InputSchema> {
  slug = "entity_record_delete";
  name = "Entity Record Delete Tool";
  description = "Soft-deletes an entity record.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string, onMutation?: () => void) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { connectorEntityId, entityRecordId } = this.validate(input);
          await assertStationScope(stationId, connectorEntityId);
          await assertWriteCapability(connectorEntityId);

          const existing = await DbService.repository.entityRecords.findById(entityRecordId);
          if (!existing || existing.connectorEntityId !== connectorEntityId) {
            return { error: "Record not found or does not belong to entity" };
          }

          await DbService.repository.entityRecords.softDelete(entityRecordId, userId);
          onMutation?.();
          return { success: true, recordId: entityRecordId };
        } catch (err: any) {
          return { error: err.message ?? "Failed to delete record" };
        }
      },
    });
  }
}

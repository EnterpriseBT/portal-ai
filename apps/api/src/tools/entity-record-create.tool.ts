import { z } from "zod";
import { tool } from "ai";
import { v4 as uuidv4 } from "uuid";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { EntityRecordModelFactory } from "@portalai/core/models";
import { assertStationScope, assertWriteCapability } from "../utils/resolve-capabilities.util.js";
import { NormalizationService } from "../services/normalization.service.js";

const InputSchema = z.object({
  connectorEntityId: z.string().describe("The connector entity to create a record in"),
  sourceId: z.string().optional().describe("Optional source ID; auto-generated if omitted"),
  data: z.record(z.string(), z.unknown()).describe("Record data keyed by source field names"),
});

export class EntityRecordCreateTool extends Tool<typeof InputSchema> {
  slug = "entity_record_create";
  name = "Entity Record Create Tool";
  description = "Creates a new entity record with auto-normalized data.";

  get schema() { return InputSchema; }

  build(stationId: string, organizationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { connectorEntityId, sourceId, data } = this.validate(input);
          await assertStationScope(stationId, connectorEntityId);
          await assertWriteCapability(connectorEntityId);

          const { normalizedData, validationErrors, isValid } = await NormalizationService.normalize(connectorEntityId, data);

          const factory = new EntityRecordModelFactory();
          const model = factory.create(userId);
          model.update({
            organizationId,
            connectorEntityId,
            data,
            normalizedData,
            sourceId: sourceId ?? uuidv4(),
            checksum: "manual",
            syncedAt: Date.now(),
            origin: "portal",
            isValid,
            validationErrors,
          });

          const entity = await DbService.repository.connectorEntities.findById(connectorEntityId);
          const record = await DbService.repository.entityRecords.create(model.parse());

          if (entity) {
            AnalyticsService.applyRecordInsert(stationId, entity.key, {
              _record_id: record.id,
              _connector_entity_id: connectorEntityId,
              ...normalizedData,
            });
          }
          return {
            success: true,
            operation: "created",
            entity: "record",
            entityId: record.id,
            summary: { entityLabel: entity?.label ?? connectorEntityId, sourceId: record.sourceId },
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to create record" };
        }
      },
    });
  }
}

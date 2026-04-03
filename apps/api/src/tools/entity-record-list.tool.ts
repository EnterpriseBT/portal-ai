import { z } from "zod";
import { tool } from "ai";
import { eq } from "drizzle-orm";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { assertStationScope } from "../utils/resolve-capabilities.util.js";
import { entityRecords } from "../db/schema/index.js";

const InputSchema = z.object({
  connectorEntityId: z
    .string()
    .describe("The connector entity ID to list records for"),
  limit: z
    .number()
    .int()
    .min(1)
    .max(100)
    .default(20)
    .describe("Maximum number of records to return (1–100, default 20)"),
  offset: z
    .number()
    .int()
    .min(0)
    .default(0)
    .describe("Number of records to skip (default 0)"),
});

export class EntityRecordListTool extends Tool<typeof InputSchema> {
  slug = "entity_record_list";
  name = "Entity Record List Tool";
  description =
    "Lists paginated records for a given connector entity. " +
    "Returns record IDs, source IDs, and normalized data.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { connectorEntityId, limit, offset } = this.validate(input);

        await assertStationScope(stationId, connectorEntityId);

        const where = eq(
          entityRecords.connectorEntityId,
          connectorEntityId,
        );

        const [records, total] = await Promise.all([
          DbService.repository.entityRecords.findMany(where, {
            limit,
            offset,
          }),
          DbService.repository.entityRecords.countByConnectorEntityId(
            connectorEntityId,
          ),
        ]);

        return {
          records: records.map((r) => ({
            id: r.id,
            sourceId: r.sourceId,
            normalizedData: r.normalizedData,
          })),
          total,
        };
      },
    });
  }
}

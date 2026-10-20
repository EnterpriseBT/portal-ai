/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import {
  assertStationScope,
  assertWriteCapability,
} from "../utils/resolve-capabilities.util.js";
import { Repository } from "../db/repositories/base.repository.js";
import { ApiError } from "../services/http.service.js";
import { RecordWriteService } from "../services/record-write.service.js";

const ItemSchema = z.object({
  connectorEntityId: z
    .string()
    .describe("The connector entity the record belongs to"),
  entityRecordId: z.string().describe("The record ID to update"),
  data: z
    .record(z.string(), z.unknown())
    .describe(
      "Updated record data keyed by `normalizedKey` from the entity's field mappings"
    ),
});

const InputSchema = z.object({
  items: z
    .array(ItemSchema)
    .min(1)
    .max(100)
    .describe("Records to update (1–100)"),
});

export class EntityRecordUpdateTool extends Tool<typeof InputSchema> {
  slug = "entity_record_update";
  name = "Entity Record Update Tool";
  description =
    "Updates one or more entity records' data and normalized data. Accepts 1–100 items. A geometry field takes a GeoJSON geometry object or null; any other value fails the whole call and nothing is written. Needs write permission on the record and on its entity.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { items } = this.validate(input);

          // ── Phase 1: Validate ──────────────────────────────────────
          const groups = new Map<string, typeof items>();
          for (const item of items) {
            const group = groups.get(item.connectorEntityId) ?? [];
            group.push(item);
            groups.set(item.connectorEntityId, group);
          }

          const failures: { index: number; error: string }[] = [];

          // Scope checks once per entity
          for (const connectorEntityId of groups.keys()) {
            try {
              await assertStationScope(stationId, connectorEntityId);
              await assertWriteCapability(connectorEntityId);
            } catch (err: any) {
              const groupItems = groups.get(connectorEntityId)!;
              for (const item of groupItems) {
                failures.push({
                  index: items.indexOf(item),
                  error: err.message ?? "Scope/capability check failed",
                });
              }
            }
          }

          if (failures.length > 0) {
            return {
              success: false,
              error: `${failures.length} of ${items.length} items failed validation`,
              failures,
            };
          }

          // Verify each record exists and belongs to its entity, so a bad id
          // is reported per item before anything is written.
          for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const existing = await DbService.repository.entityRecords.findById(
              item.entityRecordId
            );
            if (
              !existing ||
              existing.connectorEntityId !== item.connectorEntityId
            ) {
              failures.push({
                index: i,
                error: "Record not found or does not belong to entity",
              });
            }
          }

          if (failures.length > 0) {
            return {
              success: false,
              error: `${failures.length} of ${items.length} items failed validation`,
              failures,
            };
          }

          // ── Phase 2: Execute ───────────────────────────────────────
          // #760: the same write as PATCH /records/:id. Each item merges into
          // the record's stored `data` under a row lock, and the normalized
          // values and validity land on both stores. One transaction: a
          // refused item rolls back every item.
          await Repository.transaction(async (tx) => {
            for (const [idx, item] of items.entries()) {
              try {
                await RecordWriteService.patchRecord(tx, {
                  connectorEntityId: item.connectorEntityId,
                  recordId: item.entityRecordId,
                  patch: { normalizedData: item.data },
                  userId,
                });
              } catch (err) {
                // #757: in a multi-item call, say which item to fix.
                if (err instanceof ApiError && items.length > 1) {
                  throw new ApiError(
                    err.status ?? 400,
                    err.code,
                    `items[${idx}] (record ${item.entityRecordId}): ${err.message}; nothing was written`,
                    err.details
                  );
                }
                throw err;
              }
            }
          });

          return {
            success: true,
            operation: "updated" as const,
            entity: "record",
            count: items.length,
            items: items.map((item) => ({
              entityId: item.entityRecordId,
              summary: { fields: Object.keys(item.data) },
            })),
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to update records" };
        }
      },
    });
  }
}

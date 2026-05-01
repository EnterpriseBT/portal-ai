/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
import { z } from "zod";
import { tool } from "ai";
import { v4 as uuidv4 } from "uuid";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { EntityRecordModelFactory } from "@portalai/core/models";
import {
  assertStationScope,
  assertWriteCapability,
} from "../utils/resolve-capabilities.util.js";
import { NormalizationService } from "../services/normalization.service.js";
import { Repository } from "../db/repositories/base.repository.js";

const ItemSchema = z.object({
  connectorEntityId: z
    .string()
    .describe("The connector entity to create a record in"),
  sourceId: z
    .string()
    .optional()
    .describe("Optional source ID; auto-generated if omitted"),
  data: z
    .record(z.string(), z.unknown())
    .describe(
      "Record data keyed by `normalizedKey` from the entity's field mappings"
    ),
});

const InputSchema = z.object({
  items: z
    .array(ItemSchema)
    .min(1)
    .max(100)
    .describe("Records to create (1–100)"),
});

export class EntityRecordCreateTool extends Tool<typeof InputSchema> {
  slug = "entity_record_create";
  name = "Entity Record Create Tool";
  description =
    "Creates one or more entity records with auto-normalized data. Accepts 1–100 items.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, organizationId: string, userId: string) {
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

          // Normalize per group
          type NormResult = {
            normalizedData: Record<string, unknown>;
            validationErrors: any;
            isValid: boolean;
          };
          const normResults: NormResult[] = new Array(items.length);

          for (const [connectorEntityId, groupItems] of groups) {
            const dataArray = groupItems.map((item) => item.data);
            const results = await NormalizationService.normalizeMany(
              connectorEntityId,
              dataArray
            );
            for (let i = 0; i < groupItems.length; i++) {
              normResults[items.indexOf(groupItems[i])] = results[
                i
              ] as NormResult;
            }
          }

          // Build models
          const factory = new EntityRecordModelFactory();
          const parsedModels = items.map((item, idx) => {
            const norm = normResults[idx];
            const model = factory.create(userId);
            model.update({
              organizationId,
              connectorEntityId: item.connectorEntityId,
              data: item.data,
              normalizedData: norm.normalizedData,
              sourceId: item.sourceId ?? uuidv4(),
              checksum: "manual",
              syncedAt: Date.now(),
              origin: "portal",
              isValid: norm.isValid,
              validationErrors: norm.validationErrors,
            });
            return model.parse();
          });

          // ── Phase 2: Execute ───────────────────────────────────────
          const created = await Repository.transaction(async (tx) => {
            return DbService.repository.entityRecords.createMany(
              parsedModels,
              tx
            );
          });

          // ── Phase 3: Cache ─────────────────────────────────────────
          for (const connectorEntityId of groups.keys()) {
            const entity =
              await DbService.repository.connectorEntities.findById(
                connectorEntityId
              );
            if (!entity) continue;
            const groupItems = groups.get(connectorEntityId)!;
            const rows = groupItems.map((item) => {
              const idx = items.indexOf(item);
              const record = created[idx];
              const norm = normResults[idx];
              return {
                _record_id: record.id,
                _connector_entity_id: connectorEntityId,
                ...norm.normalizedData,
              };
            });
            AnalyticsService.applyRecordInsertMany(
              stationId,
              (entity as any).key,
              rows
            );
          }

          return {
            success: true,
            operation: "created" as const,
            entity: "record",
            count: created.length,
            items: created.map((record, idx) => ({
              entityId: record.id,
              summary: { sourceId: parsedModels[idx].sourceId },
            })),
          };
        } catch (err: any) {
          return { error: err.message ?? "Failed to create records" };
        }
      },
    });
  }
}

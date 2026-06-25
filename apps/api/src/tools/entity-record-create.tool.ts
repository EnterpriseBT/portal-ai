/* eslint-disable @typescript-eslint/no-explicit-any -- escape hatches for drizzle ORM and JSONB typings; values are validated upstream. */
import { z } from "zod";
import { tool } from "ai";
import { v4 as uuidv4 } from "uuid";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { EntityRecordModelFactory } from "@portalai/core/models";
import {
  assertStationScope,
  assertWriteCapability,
} from "../utils/resolve-capabilities.util.js";
import { NormalizationService } from "../services/normalization.service.js";
import { Repository } from "../db/repositories/base.repository.js";
import { wideTableStatementCache } from "../services/wide-table-statement.cache.js";
import {
  projectToWideRow,
  buildMappingsForProjection,
} from "../services/wide-table-projection.util.js";

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

              // #154: refuse to write to an entity with ZERO field mappings.
              // Such records can't be projected into the wide table, so
              // sql_query / display_entity_records never see them (silent
              // "ghost" rows). Scoped to zero mappings so the legitimate
              // "mappings exist, wide table not yet reconciled" case still
              // proceeds (the wide-table mirror below already defers that).
              const mappingCount =
                await DbService.repository.fieldMappings.countByConnectorEntityIds(
                  [connectorEntityId]
                );
              if (mappingCount === 0) {
                for (const item of groups.get(connectorEntityId)!) {
                  failures.push({
                    index: items.indexOf(item),
                    error:
                      "Entity has no field mappings, so its records would not be " +
                      "queryable. Create field mappings with field_mapping_create " +
                      "(pick a columnDefinitionId from station_context.columnDefinitions) " +
                      "before creating records.",
                  });
                }
              }
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
          // Carry `normalizedData` from the model.parse() output keyed
          // by the resulting row id — the table inference no longer
          // includes it after slice 6, so the wide-table projection
          // can't read it back off the inserted row.
          const normalizedById = new Map<string, Record<string, unknown>>();
          for (const parsed of parsedModels) {
            normalizedById.set(parsed.id, parsed.normalizedData);
          }
          const created = await Repository.transaction(async (tx) => {
            const inserted =
              await DbService.repository.entityRecords.createMany(
                parsedModels,
                tx
              );
            // Mirror into the wide table per entity. Each connector
            // entity has its own `er__<id>` table + statement cache.
            // Skip the mirror write if the wide table has no live data
            // columns (the reconciler hasn't run for this entity yet);
            // Phase 2 slice 7's re-sync trigger or the field-mapping
            // routes' reconciliation will populate it.
            const byEntity = new Map<string, typeof inserted>();
            for (const row of inserted) {
              const list = byEntity.get(row.connectorEntityId) ?? [];
              list.push(row);
              byEntity.set(row.connectorEntityId, list);
            }
            for (const [entityId, rows] of byEntity) {
              const stmt = await wideTableStatementCache.get(entityId, tx);
              if (stmt.columns.length === 0) continue;
              const mappings = buildMappingsForProjection(stmt.columns);
              await DbService.repository.wideTable.upsertMany(
                entityId,
                rows.map((r) =>
                  projectToWideRow(
                    {
                      id: r.id,
                      organizationId: r.organizationId,
                      sourceId: r.sourceId,
                      syncedAt: r.syncedAt,
                      isValid: r.isValid,
                      normalizedData: normalizedById.get(r.id) ?? null,
                    },
                    mappings
                  )
                ),
                tx
              );
            }
            return inserted;
          });

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

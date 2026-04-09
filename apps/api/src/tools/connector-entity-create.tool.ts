import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { AnalyticsService } from "../services/analytics.service.js";
import { ConnectorEntityModelFactory } from "@portalai/core/models";
import { stationInstancesRepo } from "../db/repositories/station-instances.repository.js";
import { connectorDefinitionsRepo } from "../db/repositories/connector-definitions.repository.js";
import { resolveCapabilities } from "../utils/resolve-capabilities.util.js";
import { Repository } from "../db/repositories/base.repository.js";

const ItemSchema = z.object({
  connectorInstanceId: z.string().describe("The connector instance to create the entity under"),
  key: z.string().min(1).describe("Unique key for the entity (used as AlaSQL table name)"),
  label: z.string().min(1).describe("Human-readable label"),
});

const InputSchema = z.object({
  items: z.array(ItemSchema).min(1).max(100).describe("Connector entities to create (1–100)"),
});

export class ConnectorEntityCreateTool extends Tool<typeof InputSchema> {
  slug = "connector_entity_create";
  name = "Connector Entity Create Tool";
  description = "Creates one or more connector entities under attached connector instances. Accepts 1–100 items.";

  get schema() { return InputSchema; }

  build(stationId: string, userId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { items } = this.validate(input);

          // ── Phase 1: Validate ──────────────────────────────────────
          const failures: { index: number; error: string }[] = [];

          // Load station links once
          const stationLinks = await stationInstancesRepo.findByStationId(stationId);
          const attachedIds = new Set(stationLinks.map((l) => l.connectorInstanceId));

          // Group by connectorInstanceId — validate once per instance
          const instanceGroups = new Map<string, typeof items>();
          for (const item of items) {
            const group = instanceGroups.get(item.connectorInstanceId) ?? [];
            group.push(item);
            instanceGroups.set(item.connectorInstanceId, group);
          }

          const instanceOrgMap = new Map<string, string>(); // instanceId → organizationId

          for (const [connectorInstanceId, groupItems] of instanceGroups) {
            if (!attachedIds.has(connectorInstanceId)) {
              for (const item of groupItems) {
                failures.push({ index: items.indexOf(item), error: "Connector instance is not attached to this station" });
              }
              continue;
            }

            const instance = await DbService.repository.connectorInstances.findById(connectorInstanceId);
            if (!instance) {
              for (const item of groupItems) {
                failures.push({ index: items.indexOf(item), error: "Connector instance not found" });
              }
              continue;
            }

            const definition = await connectorDefinitionsRepo.findById(instance.connectorDefinitionId);
            if (!definition) {
              for (const item of groupItems) {
                failures.push({ index: items.indexOf(item), error: "Connector definition not found" });
              }
              continue;
            }

            const capabilities = resolveCapabilities(definition, instance);
            if (!capabilities.write) {
              for (const item of groupItems) {
                failures.push({ index: items.indexOf(item), error: "Cannot create entity — the connector instance does not have write capability enabled" });
              }
              continue;
            }

            instanceOrgMap.set(connectorInstanceId, instance.organizationId);
          }

          if (failures.length > 0) {
            return { success: false, error: `${failures.length} of ${items.length} items failed validation`, failures };
          }

          // ── Phase 2: Execute ───────────────────────────────────────
          const factory = new ConnectorEntityModelFactory();
          const results: { id: string }[] = [];

          await Repository.transaction(async (tx) => {
            for (const item of items) {
              const orgId = instanceOrgMap.get(item.connectorInstanceId)!;
              const model = factory.create(userId);
              model.update({
                organizationId: orgId,
                connectorInstanceId: item.connectorInstanceId,
                key: item.key,
                label: item.label,
              });
              const result = await DbService.repository.connectorEntities.upsertByKey(model.parse(), tx);
              results.push(result);
            }
          });

          // ── Phase 3: Cache ─────────────────────────────────────────
          const cacheRows = items.map((item, idx) => ({
            id: results[idx].id,
            key: item.key,
            label: item.label,
            connectorInstanceId: item.connectorInstanceId,
          }));
          AnalyticsService.applyEntityInsertMany(stationId, cacheRows);

          return {
            success: true,
            operation: "created" as const,
            entity: "connector entity",
            count: results.length,
            items: items.map((item, idx) => ({
              entityId: results[idx].id,
              summary: { key: item.key, label: item.label },
            })),
          };
        } catch (err: unknown) {
          const message = err instanceof Error ? err.message : "Failed to create entities";
          return { error: message };
        }
      },
    });
  }
}

import { z } from "zod";
import { tool } from "ai";

import { Tool } from "../types/tools.js";
import { DbService } from "../services/db.service.js";
import { ConnectorEntityModelFactory } from "@portalai/core/models";
import { keyField, nameField } from "@portalai/core/contracts";
import { stationInstancesRepo } from "../db/repositories/station-instances.repository.js";
import { connectorDefinitionsRepo } from "../db/repositories/connector-definitions.repository.js";
import { resolveCapabilities } from "../utils/resolve-capabilities.util.js";
import { Repository } from "../db/repositories/base.repository.js";
import { wideTableReconcilerService } from "../services/wide-table-reconciler.service.js";
import { unwrapPgError } from "../utils/pg-error.util.js";
import { createLogger } from "../utils/logger.util.js";

const logger = createLogger({ module: "connector-entity-create-tool" });

const ItemSchema = z.object({
  connectorInstanceId: z
    .string()
    .describe("The connector instance to create the entity under"),
  key: keyField()
    .regex(
      /^[a-z][a-z0-9_]*$/,
      "Key must start with a lowercase letter and use only lowercase letters, digits and underscores"
    )
    .describe("Unique key for the entity (used as AlaSQL table name)"),
  label: nameField("Label").describe("Human-readable label"),
});

const InputSchema = z.object({
  items: z
    .array(ItemSchema)
    .min(1)
    .max(100)
    .describe("Connector entities to create (1–100)"),
});

/** #825: the per-item refusal for a key the organization already uses. */
function alreadyExists(key: string | null): string {
  return (
    (key
      ? `An entity with key "${key}" already exists in this organization`
      : "An entity with one of these keys already exists in this organization") +
    ". This tool only creates entities; use connector_entity_update to change an existing one."
  );
}

export class ConnectorEntityCreateTool extends Tool<typeof InputSchema> {
  slug = "connector_entity_create";
  name = "Connector Entity Create Tool";
  description =
    "Creates one or more connector entities under attached connector instances. Accepts 1–100 items. An existing key is refused; use `connector_entity_update` to change an entity. Needs write permission on the connector instance; read alone is refused.";

  get schema() {
    return InputSchema;
  }

  /**
   * `portalId` is the portal session running the tool, recorded on the row as
   * provenance (#641). It never affects ownership: `createdBy` is the caller.
   */
  build(stationId: string, userId: string, portalId: string | null) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        try {
          const { items } = this.validate(input);

          // ── Phase 1: Validate ──────────────────────────────────────
          const failures: { index: number; error: string }[] = [];

          // Load station links once
          const stationLinks =
            await stationInstancesRepo.findByStationId(stationId);
          const attachedIds = new Set(
            stationLinks.map((l) => l.connectorInstanceId)
          );

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
                failures.push({
                  index: items.indexOf(item),
                  error: "Connector instance is not attached to this station",
                });
              }
              continue;
            }

            const instance =
              await DbService.repository.connectorInstances.findById(
                connectorInstanceId
              );
            if (!instance) {
              for (const item of groupItems) {
                failures.push({
                  index: items.indexOf(item),
                  error: "Connector instance not found",
                });
              }
              continue;
            }

            const definition = await connectorDefinitionsRepo.findById(
              instance.connectorDefinitionId
            );
            if (!definition) {
              for (const item of groupItems) {
                failures.push({
                  index: items.indexOf(item),
                  error: "Connector definition not found",
                });
              }
              continue;
            }

            const capabilities = resolveCapabilities(definition, instance);
            if (!capabilities.write) {
              for (const item of groupItems) {
                failures.push({
                  index: items.indexOf(item),
                  error:
                    "Cannot create entity — the connector instance does not have write capability enabled",
                });
              }
              continue;
            }

            instanceOrgMap.set(connectorInstanceId, instance.organizationId);
          }

          // #825: a create never modifies an existing row. The permission
          // gate authorized "a new entity the caller owns", not a change to
          // an entity someone else may own, so an existing key is refused
          // and the agent is pointed at the update tool, which checks write
          // on that entity.
          // A key repeated within this batch would trip the unique index on
          // the second insert; refuse it up front, naming the repeat.
          const seenKeys = new Set<string>();
          for (const [index, item] of items.entries()) {
            const orgId = instanceOrgMap.get(item.connectorInstanceId);
            if (!orgId) continue;
            const batchKey = `${orgId}:${item.key}`;
            if (seenKeys.has(batchKey)) {
              failures.push({
                index,
                error: `This batch repeats key "${item.key}"; send each entity once.`,
              });
              continue;
            }
            seenKeys.add(batchKey);
            const existing =
              await DbService.repository.connectorEntities.findByOrganizationAndKey(
                orgId,
                item.key
              );
            if (existing) {
              failures.push({ index, error: alreadyExists(item.key) });
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
                sourcePortalId: portalId,
              });
              const result =
                await DbService.repository.connectorEntities.create(
                  model.parse(),
                  tx
                );
              results.push(result);
            }
          }).catch((err: unknown) => {
            // A key taken between the check above and this insert trips the
            // unique index: still "already exists", never an update.
            if (unwrapPgError(err).code === "23505") {
              throw new Error(alreadyExists(null));
            }
            throw err;
          });

          // Provision each new entity's `er__<id>` wide-table so any curated
          // view over it can materialize (the CREATE VIEW aliasing the entity
          // would otherwise reference a missing relation). NOTE (#599): a new
          // entity is NOT auto-exposed — the agent SQL session is scoped to
          // granted curated views (`resolveViewsForSession`), and no default
          // view is created (explicit views only). Raw data is reachable via
          // the Entities API (RBAC-gated); in-session view creation is #645.
          // The route at
          // `connector-entity.router.ts:459` does the same thing; this
          // closes the gap between the route- and tool-driven creation
          // paths. Per-entity failures don't abort the tool result —
          // the entity row is already persisted; we just log so the
          // user / agent can see what happened.
          for (const created of results) {
            try {
              await wideTableReconcilerService.ensureTable(created.id);
            } catch (err) {
              logger.error(
                {
                  connectorEntityId: created.id,
                  err,
                },
                "ensureTable failed after connector_entity_create"
              );
            }
          }

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
          const message =
            err instanceof Error ? err.message : "Failed to create entities";
          return { error: message };
        }
      },
    });
  }
}

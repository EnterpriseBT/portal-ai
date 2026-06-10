import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { DbService } from "../services/db.service.js";
import { loadConnectorInstanceContexts } from "../services/portal.service.js";
import { wideTableStatementCache } from "../services/wide-table-statement.cache.js";
import { resolveEntityCapabilities } from "../utils/resolve-capabilities.util.js";
import { isValidIanaTimezone } from "../utils/timezone.util.js";
import { Tool } from "../types/tools.js";

/**
 * `station_context` (#97).
 *
 * Returns the authoritative, on-demand view of everything attached to
 * the current station: entities (with their full column inventory —
 * including the `c_<…>` wide-column names — capabilities, and
 * connector-entity ids), connector instances, and entity groups.
 *
 * Lives in the `station_context` toolpack — auto-attached to every
 * station regardless of the other packs enabled. The agent should
 * call it whenever it needs a `connectorEntityId`,
 * `connectorInstanceId`, `columnDefinitionId`, `fieldMappingId`, or
 * wide-column name to pass to another tool — never invent friendly
 * names, never ask the user.
 */

const InputSchema = z.object({
  entityKeys: z
    .array(z.string())
    .optional()
    .describe(
      "Narrow the `entities` array to only those whose `key` matches. " +
        "Omit to return every entity on the station."
    ),
  include: z
    .array(
      z.enum([
        "entities",
        "connectorInstances",
        "entityGroups",
        "capabilities",
      ])
    )
    .optional()
    .describe(
      "Which top-level sections to include. Omit to include all. " +
        "Pass `['entities']` when you only need entity schema and want a smaller response."
    ),
});

interface StationContextResponse {
  station: {
    id: string;
    name: string;
    timezone: string;
  };
  entities?: Array<{
    id: string;
    key: string;
    label: string;
    connectorInstanceId: string;
    connectorInstanceName: string | null;
    capabilities?: { read: boolean; write: boolean; push: boolean };
    columns: Array<{
      key: string;
      wideColumnName: string | null;
      label: string;
      type: string;
      columnDefinitionId: string;
      fieldMappingId: string;
      sourceField: string;
    }>;
  }>;
  connectorInstances?: Array<{
    id: string;
    name: string;
    display: string;
    slug: string;
  }>;
  entityGroups?: Array<{
    id: string;
    name: string;
    members: Array<{
      entityKey: string;
      connectorEntityId: string;
      linkColumnKey: string;
      linkColumnLabel: string;
      linkNormalizedKey: string;
      isPrimary: boolean;
    }>;
  }>;
}

export class StationContextTool extends Tool<typeof InputSchema> {
  slug = "station_context";
  name = "Station Context";
  description =
    "Return the live, authoritative view of everything attached to the " +
    "current station: entities (with `connectorEntityId`, `[read,write,push]` " +
    "capabilities, and every column's `key` / `wideColumnName` / " +
    "`columnDefinitionId` / `fieldMappingId` / `sourceField`), connector " +
    "instances (with `connectorInstanceId`), and entity groups. **Call this " +
    "before any tool that asks for a `connectorEntityId`, " +
    "`connectorInstanceId`, `columnDefinitionId`, `fieldMappingId`, or " +
    "wide-column name** — do not invent values, do not ask the user, and " +
    "do not rely on the static `## Available Data` block for ids. Pass " +
    "`entityKeys: ['<key>']` when you only need one entity's schema.";

  get schema() {
    return InputSchema;
  }

  build(stationId: string, organizationId: string) {
    return tool({
      description: this.description,
      inputSchema: this.schema,
      execute: async (input) => {
        const { entityKeys, include } = this.validate(input);
        const sections = new Set(
          include ?? [
            "entities",
            "connectorInstances",
            "entityGroups",
            "capabilities",
          ]
        );

        // Always include the station header.
        const station = await DbService.repository.stations.findById(stationId);
        const org =
          await DbService.repository.organizations.findById(organizationId);
        const rawTz = org?.timezone ?? "UTC";
        const timezone = isValidIanaTimezone(rawTz) ? rawTz : "UTC";

        const response: StationContextResponse = {
          station: {
            id: stationId,
            name: station?.name ?? "(unknown)",
            timezone,
          },
        };

        // Single round-trip for entities + groups (and connector
        // instances are loaded out-of-band; cheap).
        const stationData = await AnalyticsService.loadStation(
          stationId,
          organizationId
        );

        // Capabilities are scoped to entity_management consumers but
        // cheap to compute, so we attach them whenever `capabilities`
        // (or no filter) was requested — the agent can decide what to
        // read.
        const caps = sections.has("capabilities")
          ? await resolveEntityCapabilities(stationId)
          : undefined;

        if (sections.has("entities")) {
          const filtered = entityKeys
            ? stationData.entities.filter((e) => entityKeys.includes(e.key))
            : stationData.entities;

          // Per-entity wide-column lookup. Returns the `c_<…>` name
          // alongside each column's `normalizedKey` so callers can map
          // user-facing keys → physical columns without grepping
          // `_meta_columns`. Failures don't abort the whole tool —
          // an entity with no live wide table still shows up with
          // wideColumnName: null per column.
          const entitiesOut = await Promise.all(
            filtered.map(async (e) => {
              const wideByKey = new Map<string, string>();
              try {
                const stmt = await wideTableStatementCache.get(e.id);
                for (const c of stmt.columns) {
                  wideByKey.set(c.normalizedKey, c.columnName);
                }
              } catch {
                // Wide table not yet provisioned — leave wideColumnName null.
              }

              return {
                id: e.id,
                key: e.key,
                label: e.label,
                connectorInstanceId: e.connectorInstanceId,
                connectorInstanceName: null as string | null,
                ...(caps && caps[e.id]
                  ? { capabilities: caps[e.id] }
                  : {}),
                columns: e.columns.map((col) => ({
                  key: col.key,
                  wideColumnName: wideByKey.get(col.key) ?? null,
                  label: col.label,
                  type: col.type,
                  columnDefinitionId: col.columnDefinitionId,
                  fieldMappingId: col.fieldMappingId,
                  sourceField: col.sourceField,
                })),
              };
            })
          );
          response.entities = entitiesOut;
        }

        const instances = sections.has("connectorInstances") ||
          sections.has("entities")
          ? await loadConnectorInstanceContexts(stationId)
          : null;

        // Fill in connectorInstanceName on each entity if we loaded
        // the instances.
        if (response.entities && instances) {
          const nameById = new Map(instances.map((i) => [i.id, i.name]));
          for (const e of response.entities) {
            e.connectorInstanceName =
              nameById.get(e.connectorInstanceId) ?? null;
          }
        }

        if (sections.has("connectorInstances") && instances) {
          response.connectorInstances = instances;
        }

        if (sections.has("entityGroups")) {
          response.entityGroups = stationData.entityGroups.map((g) => ({
            id: g.id,
            name: g.name,
            members: g.members.map((m) => ({
              entityKey: m.entityKey,
              connectorEntityId: m.connectorEntityId,
              linkColumnKey: m.linkColumnKey,
              linkColumnLabel: m.linkColumnLabel,
              linkNormalizedKey: m.linkNormalizedKey,
              isPrimary: m.isPrimary,
            })),
          }));
        }

        return response;
      },
    });
  }
}

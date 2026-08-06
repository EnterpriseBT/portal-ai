import { z } from "zod";
import { tool } from "ai";

import { AnalyticsService } from "../services/analytics.service.js";
import { DbService } from "../services/db.service.js";
import { EntitlementService } from "../services/entitlement.service.js";
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
        "columnDefinitions",
        "toolPacks",
      ])
    )
    .optional()
    .describe(
      "Which top-level sections to include. Omit to include all. " +
        "Pass `['entities']` when you only need entity schema and want a smaller response. " +
        "Pass `['columnDefinitions']` to get the organization's column-definition catalog " +
        "(the `columnDefinitionId`s available to `field_mapping_create`)."
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
  /**
   * The organization's column-definition catalog — the admin-curated set
   * of columns the agent maps to. `field_mapping_create` takes a
   * `columnDefinitionId` from this list; the agent has no
   * `column_definition_create` tool, so when a needed column isn't here it
   * surfaces the gap rather than inventing one. Distinct from an entity's
   * `columns` (which are the definitions already bound to that entity).
   */
  columnDefinitions?: Array<{
    columnDefinitionId: string;
    key: string;
    label: string;
    type: string;
    description: string | null;
  }>;
  /**
   * The station's built-in tool packs, split by what the organization's plan
   * includes (#284).
   *
   * `effective` packs have live tools in this session. `unentitled` packs are
   * attached to the station but excluded by the plan — their tools do not
   * exist here, and asking for what they'd do is a plan limit, not a missing
   * product capability. Reported as a field because an agent can misread
   * prose but not a value it has to read.
   */
  toolPacks?: {
    effective: string[];
    unentitled: string[];
    /**
     * Org-registered (webhook) packs attached to this station (#306), with the
     * tools each provides. Empty when the plan excludes custom toolpacks.
     * These are LIVE tools — never report a pack listed here as unavailable,
     * and never attribute its absence to the plan.
     */
    custom: Array<{
      name: string;
      description: string | null;
      toolNames: string[];
    }>;
  };
}

export class StationContextTool extends Tool<typeof InputSchema> {
  slug = "station_context";
  name = "Station Context";
  description =
    "Return the live, authoritative view of everything attached to the " +
    "current station: entities (with `connectorEntityId`, `[read,write,push]` " +
    "capabilities, and every column's `key` / `wideColumnName` / " +
    "`columnDefinitionId` / `fieldMappingId` / `sourceField`), connector " +
    "instances (with `connectorInstanceId`), entity groups, and the " +
    "organization's `columnDefinitions` catalog (the `columnDefinitionId`s " +
    "available to `field_mapping_create`), and `toolPacks` — the station's " +
    "packs split into `effective` (built-in, their tools exist in this " +
    "session), `unentitled` (built-in, attached but not included in the " +
    "organization's plan, so their tools do NOT exist here), and `custom` " +
    "(toolpacks your organization registered itself, with the `toolNames` " +
    "each provides — these are live, callable tools). **Call this " +
    "before any tool that " +
    "asks for a `connectorEntityId`, `connectorInstanceId`, " +
    "`columnDefinitionId`, `fieldMappingId`, or wide-column name** — do not " +
    "invent values, do not ask the user, and do not rely on the static " +
    "`## Available Data` block for ids. To map a new column onto an entity, " +
    "pick a `columnDefinitionId` from `columnDefinitions` and pass it to " +
    "`field_mapping_create`; if no definition fits, say so rather than " +
    "guessing. Pass `entityKeys: ['<key>']` when you only need one entity's " +
    "schema.";

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
            "columnDefinitions",
            "toolPacks",
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

        // #284: the station's configured packs, split against the plan. Read
        // here rather than threaded in, so the tool tells the truth no matter
        // which session built it.
        if (sections.has("toolPacks")) {
          // #306: one derivation for both kinds of pack. This used to read
          // `builtinSlug` only, so a registered custom pack was invisible here
          // and the agent denied holding tools it could call.
          const { effective, unentitled, customPacks } =
            await EntitlementService.resolveStationPacks(
              stationId,
              organizationId
            );
          response.toolPacks = { effective, unentitled, custom: customPacks };
        }

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
                ...(caps && caps[e.id] ? { capabilities: caps[e.id] } : {}),
                columns: e.columns.map((col) => ({
                  key: col.key,
                  wideColumnName: wideByKey.get(col.key) ?? null,
                  label: col.label,
                  type: col.type,
                  // #316: geometry columns are SRID-4326 — surface it so the
                  // agent knows what to ST_Transform from / compose against.
                  // Non-geometry columns carry no SRID.
                  srid: col.type === "geometry" ? 4326 : null,
                  columnDefinitionId: col.columnDefinitionId,
                  fieldMappingId: col.fieldMappingId,
                  sourceField: col.sourceField,
                })),
              };
            })
          );
          response.entities = entitiesOut;
        }

        const instances =
          sections.has("connectorInstances") || sections.has("entities")
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

        if (sections.has("columnDefinitions")) {
          // The org's curated column-definition catalog — the source of
          // `columnDefinitionId`s for `field_mapping_create`. The agent maps
          // to these (it can't create definitions), so surfacing them here
          // lets it set up an entity's columns instead of writing unmapped
          // records that no read path can see.
          const defs =
            await DbService.repository.columnDefinitions.findByOrganizationId(
              organizationId
            );
          response.columnDefinitions = defs.map((d) => ({
            columnDefinitionId: d.id,
            key: d.key,
            label: d.label,
            type: d.type,
            description: d.description ?? null,
          }));
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

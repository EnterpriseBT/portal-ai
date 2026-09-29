/**
 * The searchable-object source for the policy editor's instance picker (#622
 * slice 5). Given a `resourceType`, returns `{ id, label }` candidates the
 * caller can **see** (`visibilityPredicate` from their resolved set) matching a
 * name/label `ILIKE` — so an author picks objects by name, never a typed id,
 * and only ones they could grant on. Only management-plane types with a
 * human-readable label are searchable; `field_mapping`/`entity_record` and the
 * pseudo-resources return no candidates (instance picking is for management
 * objects). Curated views (#599) and the global connector catalog (#638) are
 * searchable too.
 *
 * The searchable set must equal core's instance-scope matrix
 * (`resourceAllowsInstanceScope`, minus the fixed-id `page`) — the editor enables
 * "Specific objects" from core, the candidates come from here. An integration
 * test pins the two against {@link RBAC_SEARCHABLE_RESOURCE_TYPES} (#638: they
 * had drifted both ways).
 */

import { and, eq, ilike, isNull, type SQL } from "drizzle-orm";
import type { PgColumn, PgTable } from "drizzle-orm/pg-core";

import { db } from "../db/client.js";
import {
  stations,
  portalResults,
  portals,
  connectorInstances,
  connectorEntities,
  connectorDefinitions,
  curatedViews,
} from "../db/schema/index.js";
import {
  PermissionService,
  type PermissionContext,
} from "./permission.service.js";
import type { RbacObject } from "@portalai/core/contracts";

interface TypeConfig {
  table: PgTable;
  idCol: PgColumn;
  labelCol: PgColumn;
  createdByCol: PgColumn;
  /** Absent for a **global** registry (no `organizationId` column) — the org
   *  filter is skipped, mirroring `rbac-object-resolver`'s `GLOBAL_RESOURCE_TYPES`.
   *  Visibility still scopes the candidates to what the caller can read. */
  orgCol?: PgColumn;
  deletedCol: PgColumn;
}

/** resourceType → its searchable columns. `entity`/`curated_view` label by
 *  `label`, `connector_definition` by `display`, the rest by `name`. Absent =
 *  not instance-searchable. */
const SEARCH_CONFIG: Record<string, TypeConfig> = {
  station: {
    table: stations,
    idCol: stations.id,
    labelCol: stations.name,
    createdByCol: stations.createdBy,
    orgCol: stations.organizationId,
    deletedCol: stations.deleted,
  },
  pin: {
    table: portalResults,
    idCol: portalResults.id,
    labelCol: portalResults.name,
    createdByCol: portalResults.createdBy,
    orgCol: portalResults.organizationId,
    deletedCol: portalResults.deleted,
  },
  portal: {
    table: portals,
    idCol: portals.id,
    labelCol: portals.name,
    createdByCol: portals.createdBy,
    orgCol: portals.organizationId,
    deletedCol: portals.deleted,
  },
  connector_instance: {
    table: connectorInstances,
    idCol: connectorInstances.id,
    labelCol: connectorInstances.name,
    createdByCol: connectorInstances.createdBy,
    orgCol: connectorInstances.organizationId,
    deletedCol: connectorInstances.deleted,
  },
  entity: {
    table: connectorEntities,
    idCol: connectorEntities.id,
    labelCol: connectorEntities.label,
    createdByCol: connectorEntities.createdBy,
    orgCol: connectorEntities.organizationId,
    deletedCol: connectorEntities.deleted,
  },
  curated_view: {
    table: curatedViews,
    idCol: curatedViews.id,
    labelCol: curatedViews.label,
    createdByCol: curatedViews.createdBy,
    orgCol: curatedViews.organizationId,
    deletedCol: curatedViews.deleted,
  },
  // #638: the global catalog — no `orgCol`. Inactive definitions stay pickable
  // (the resolver accepts them; a grant on a disabled definition is harmless).
  connector_definition: {
    table: connectorDefinitions,
    idCol: connectorDefinitions.id,
    labelCol: connectorDefinitions.display,
    createdByCol: connectorDefinitions.createdBy,
    deletedCol: connectorDefinitions.deleted,
  },
};

/** The instance-searchable resource types (the keys of `SEARCH_CONFIG`). */
export const RBAC_SEARCHABLE_RESOURCE_TYPES: readonly string[] =
  Object.keys(SEARCH_CONFIG);

export class RbacObjectSearchService {
  static async search(
    caller: PermissionContext,
    resourceType: string,
    query: string,
    limit = 20
  ): Promise<RbacObject[]> {
    const cfg = SEARCH_CONFIG[resourceType];
    if (!cfg) return [];

    const set = await PermissionService.loadSet(caller);
    const visibility = set.visibilityPredicate(resourceType, {
      createdByCol: cfg.createdByCol,
      idCol: cfg.idCol,
    });

    const conditions: SQL[] = [isNull(cfg.deletedCol)];
    if (cfg.orgCol) conditions.push(eq(cfg.orgCol, caller.organizationId));
    if (query.trim()) conditions.push(ilike(cfg.labelCol, `%${query.trim()}%`));
    if (visibility) conditions.push(visibility);

    const rows = await db
      .select({ id: cfg.idCol, label: cfg.labelCol })
      .from(cfg.table)
      .where(and(...conditions))
      .limit(limit);
    return rows as RbacObject[];
  }
}

/**
 * The searchable-object source for the policy editor's instance picker (#622
 * slice 5). Given a `resourceType`, returns `{ id, label }` candidates the
 * caller can **see** (`visibilityPredicate` from their resolved set) matching a
 * name/label `ILIKE` — so an author picks objects by name, never a typed id,
 * and only ones they could grant on. Only management-plane types with a
 * human-readable label are searchable; `field_mapping`/`entity_record`/`view`
 * and the pseudo-resources return no candidates (spec: instance picking is for
 * management objects; data-plane is #599).
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
  orgCol: PgColumn;
  deletedCol: PgColumn;
}

/** resourceType → its searchable columns. `entity` labels by `label`, the
 *  rest by `name`. Absent = not instance-searchable in #622. */
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
};

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

    const conditions: SQL[] = [
      eq(cfg.orgCol, caller.organizationId),
      isNull(cfg.deletedCol),
    ];
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

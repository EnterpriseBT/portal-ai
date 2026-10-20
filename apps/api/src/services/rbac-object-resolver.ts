/**
 * Per-`resourceType` object resolution for RBAC custom authoring (#622). The
 * statement boundary (`PermissionSet.assertStatementsWithinBoundary`) injects
 * `resolveCreatedBy` so an **instance-level** authored statement is checked
 * against the target object's *real* creator — an author who created X can
 * grant on X. Only management-plane objects with a `createdBy` + org scope are
 * resolvable; `field_mapping`/`entity_record` are data-plane (#599) and `view`
 * is not built yet, so they resolve to `null` (the boundary then rejects an
 * instance statement on them — fail-closed). Slice 5 extends this map with the
 * searchable-label lookup that powers the instance picker.
 *
 * #829: records and field mappings are parts of their entity with no
 * permission of their own, so they aren't objects here; `resolvePartOwner`
 * gives the agent permission gate a part's owning entity from its stored row.
 */

import {
  OBJECT_CONTAINERS,
  PART_OWNERS,
  isContainedType,
  type PartType,
} from "@portalai/core/models";

import { DbService } from "./db.service.js";

type ResolvableRow = { organizationId: string; createdBy: string } | undefined;

/** resourceType → find one row by id (the row carries `organizationId` +
 *  `createdBy`). Absent from the map = not instance-resolvable in #622. */
const OBJECT_FINDERS: Record<string, (id: string) => Promise<ResolvableRow>> = {
  station: (id) =>
    DbService.repository.stations.findById(id) as Promise<ResolvableRow>,
  pin: (id) =>
    DbService.repository.portalResults.findById(id) as Promise<ResolvableRow>,
  portal: (id) =>
    DbService.repository.portals.findById(id) as Promise<ResolvableRow>,
  connector_instance: (id) =>
    DbService.repository.connectorInstances.findById(
      id
    ) as Promise<ResolvableRow>,
  entity: (id) =>
    DbService.repository.connectorEntities.findById(
      id
    ) as Promise<ResolvableRow>,
  // #599: curated views are shareable + instance-searchable, so an authored
  // instance statement / grant on a specific view resolves against its creator.
  curated_view: (id) =>
    DbService.repository.curatedViews.findById(id) as Promise<ResolvableRow>,
  // #630: the connector-definition catalog is a **global** registry (no org
  // column). Its finder resolves the row for the authoring boundary; the org
  // check is skipped via GLOBAL_RESOURCE_TYPES so an author holding
  // `read connector_definition` can grant a specific definition (catalog subset).
  connector_definition: (id) =>
    DbService.repository.connectorDefinitions.findById(
      id
    ) as Promise<ResolvableRow>,
};

/** Resource types resolvable but **not org-scoped** — a global registry whose
 *  rows carry no `organizationId`, so the resolver's org check is skipped. */
const GLOBAL_RESOURCE_TYPES = new Set<string>(["connector_definition"]);

/** #829: part type → find one part row by id. */
const PART_FINDERS: Record<
  PartType,
  (id: string) => Promise<Record<string, unknown> | undefined>
> = {
  entity_record: (id) =>
    DbService.repository.entityRecords.findById(id) as Promise<
      Record<string, unknown> | undefined
    >,
  field_mapping: (id) =>
    DbService.repository.fieldMappings.findById(id) as Promise<
      Record<string, unknown> | undefined
    >,
};

export class RbacObjectResolver {
  /** The object's `createdBy` if it exists (and, for org-scoped types, is in the
   *  caller's org), else `null` (absent, cross-org, or a non-resolvable type). */
  static async resolveCreatedBy(
    organizationId: string,
    resourceType: string,
    resourceId: string
  ): Promise<string | null> {
    const row = await RbacObjectResolver.resolveRow(
      organizationId,
      resourceType,
      resourceId
    );
    return row?.createdBy ?? null;
  }

  /**
   * The object's `createdBy` and, for a contained type (#829), its
   * container's id as stored on the row, never as claimed by input. `null`
   * when absent, cross-org or not resolvable; `containerId` is null for a
   * type with no container.
   */
  static async resolveRow(
    organizationId: string,
    resourceType: string,
    resourceId: string
  ): Promise<{ createdBy: string; containerId: string | null } | null> {
    const finder = OBJECT_FINDERS[resourceType];
    if (!finder) return null;
    const row = await finder(resourceId);
    if (!row) return null;
    if (
      !GLOBAL_RESOURCE_TYPES.has(resourceType) &&
      row.organizationId !== organizationId
    ) {
      return null;
    }
    const containerId = isContainedType(resourceType)
      ? (((row as Record<string, unknown>)[
          OBJECT_CONTAINERS[resourceType].containerKey
        ] as string | undefined) ?? null)
      : null;
    return { createdBy: row.createdBy, containerId };
  }

  /**
   * #829: a part's owning entity id, from its stored row (org-scoped).
   * `null` when the part is absent or in another org.
   */
  static async resolvePartOwner(
    organizationId: string,
    partType: PartType,
    partId: string
  ): Promise<string | null> {
    const row = await PART_FINDERS[partType](partId);
    if (!row || row.organizationId !== organizationId) return null;
    const owner = row[PART_OWNERS[partType].ownerKey];
    return typeof owner === "string" ? owner : null;
  }
}

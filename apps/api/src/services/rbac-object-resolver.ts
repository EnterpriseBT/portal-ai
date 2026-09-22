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
 */

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
};

export class RbacObjectResolver {
  /** The object's `createdBy` if it exists in the caller's org, else `null`
   *  (absent, cross-org, or a non-instance-resolvable type). */
  static async resolveCreatedBy(
    organizationId: string,
    resourceType: string,
    resourceId: string
  ): Promise<string | null> {
    const finder = OBJECT_FINDERS[resourceType];
    if (!finder) return null;
    const row = await finder(resourceId);
    if (!row || row.organizationId !== organizationId) return null;
    return row.createdBy;
  }
}

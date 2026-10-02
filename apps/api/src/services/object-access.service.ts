/**
 * The "may the caller see this object at all" test (#685), shared by routes
 * that act on a child row or create under a parent: the object must exist,
 * be in the caller's organization, and be readable by the caller. Anything
 * else is treated as absent (404), so an id from another org or one the
 * caller can't read reveals nothing.
 */

import type { PermissionSet } from "./permission-set.js";
import type { PermissionResourceType } from "@portalai/core/models";

interface OwnedRow {
  id: string;
  organizationId: string;
  createdBy: string;
}

export class ObjectAccessService {
  static readableInOrg<T extends OwnedRow>(
    set: PermissionSet,
    organizationId: string,
    type: PermissionResourceType,
    row: T | null | undefined
  ): row is T {
    return (
      !!row &&
      row.organizationId === organizationId &&
      set.can("resource.read", { type, id: row.id, createdBy: row.createdBy })
    );
  }

  /** The permission object for a row. */
  static object(type: PermissionResourceType, row: OwnedRow) {
    return { type, id: row.id, createdBy: row.createdBy };
  }
}

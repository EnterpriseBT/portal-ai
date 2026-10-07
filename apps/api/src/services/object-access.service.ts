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
  /**
   * #694: reading an entity group is not reading its members' entities. A
   * member whose entity the caller can't read is left out (unreadable ==
   * absent), on every route that returns a group's members.
   */
  static readableGroupMembers<T extends { connectorEntity?: OwnedRow | null }>(
    set: PermissionSet,
    organizationId: string,
    members: T[]
  ): T[] {
    return members.filter((m) =>
      ObjectAccessService.readableInOrg(
        set,
        organizationId,
        "entity",
        m.connectorEntity
      )
    );
  }

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

  /**
   * #713: authorize a by-id write, delete or share on a row the route has
   * already loaded. A row that's missing, in another org or unreadable throws
   * the route's own `notFound()` (404), so the answer matches its GET and an
   * id the caller can't see reveals nothing. Only a readable row reaches the
   * verb check, which throws 403 `PERMISSION_DENIED`. Returns the row.
   */
  static loadForVerb<T extends OwnedRow>(
    set: PermissionSet,
    organizationId: string,
    type: PermissionResourceType,
    row: T | null | undefined,
    verb: "write" | "delete" | "share",
    notFound: () => Error
  ): T {
    if (!ObjectAccessService.readableInOrg(set, organizationId, type, row)) {
      throw notFound();
    }
    set.check(`resource.${verb}`, ObjectAccessService.object(type, row));
    return row;
  }

  /** The permission object for a row. */
  static object(type: PermissionResourceType, row: OwnedRow) {
    return { type, id: row.id, createdBy: row.createdBy };
  }
}

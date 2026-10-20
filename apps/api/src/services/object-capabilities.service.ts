/**
 * #688: the caller's capabilities on the objects a payload returns.
 *
 * Every per-object GET and list attaches `capabilities` to its top-level rows,
 * computed here with the same `PermissionSet.can` the type's mutation routes
 * `check`. The UI decides what to offer from it (hide / disable / upsell,
 * epic #684), so it can never offer what the server refuses. One `loadSet` per
 * request (the route already holds it); every check here is in-memory.
 */

import {
  SHAREABLE_RESOURCE_TYPES,
  type ChildResourceType,
  type PermissionResourceType,
} from "@portalai/core/models";
import type {
  ObjectCapabilities,
  ShareableObjectCapabilities,
} from "@portalai/core/contracts";

import { ParentAccessService } from "./parent-access.service.js";
import type { PermissionSet } from "./permission-set.js";

interface OwnedRow {
  id: string;
  createdBy: string;
}

type Capabilities = ObjectCapabilities | ShareableObjectCapabilities;
type ShareableType = (typeof SHAREABLE_RESOURCE_TYPES)[number];
/** #829: a child's write/delete also depend on its parent, so a child type
 *  goes through `attachChildren`; tsc refuses it here. */
type NonChildType = Exclude<PermissionResourceType, ChildResourceType>;

const SHAREABLE = new Set<string>(SHAREABLE_RESOURCE_TYPES);

export class ObjectCapabilitiesService {
  /** The caller's capabilities on one row; `share` iff the type is shareable. */
  static for(
    set: PermissionSet,
    type: ShareableType,
    row: OwnedRow
  ): ShareableObjectCapabilities;
  static for(
    set: PermissionSet,
    type: NonChildType,
    row: OwnedRow
  ): Capabilities;
  static for(
    set: PermissionSet,
    type: NonChildType,
    row: OwnedRow
  ): Capabilities {
    return ObjectCapabilitiesService.own(set, type, row);
  }

  /** The row's own capabilities, ignoring any parent. */
  private static own(
    set: PermissionSet,
    type: PermissionResourceType,
    row: OwnedRow
  ): Capabilities {
    const object = { type, id: row.id, createdBy: row.createdBy };
    const base: ObjectCapabilities = {
      read: set.can("resource.read", object),
      write: set.can("resource.write", object),
      delete: set.can("resource.delete", object),
    };
    return SHAREABLE.has(type)
      ? { ...base, share: set.can("resource.share", object) }
      : base;
  }

  /** `rows` with `capabilities` attached, order and fields unchanged. */
  static attach<T extends OwnedRow>(
    set: PermissionSet,
    type: NonChildType,
    rows: T[]
  ): Array<T & { capabilities: Capabilities }> {
    return rows.map((row) => ({
      ...row,
      capabilities: ObjectCapabilitiesService.for(set, type, row),
    }));
  }

  /**
   * #829: a child's capabilities. A child write needs write on its parent, so
   * `write`/`delete` are its own grant AND a writable parent; `read` is the
   * row's own. One parent query for the whole page.
   */
  static async attachChildren<T extends OwnedRow>(
    set: PermissionSet,
    organizationId: string,
    type: ChildResourceType,
    rows: T[]
  ): Promise<Array<T & { capabilities: ObjectCapabilities }>> {
    const parentIds = rows
      .map((row) =>
        ParentAccessService.parentIdOf(type, row as Record<string, unknown>)
      )
      .filter((id): id is string => id != null);
    const writable = await ParentAccessService.writableParentIds(
      set,
      organizationId,
      type,
      parentIds
    );
    return rows.map((row) => {
      const own = ObjectCapabilitiesService.own(set, type, row);
      const parentId = ParentAccessService.parentIdOf(
        type,
        row as Record<string, unknown>
      );
      const parentWritable = parentId != null && writable.has(parentId);
      return {
        ...row,
        capabilities: {
          read: own.read,
          write: own.write && parentWritable,
          delete: own.delete && parentWritable,
        },
      };
    });
  }

  /**
   * Toolpacks. Builtins are platform-defined (no row, no creator): nothing in
   * an org can change or remove them, so they're read-only. Custom rows are
   * computed from the DB row's `createdBy`, which the response never exposes.
   */
  static forToolpack(
    set: PermissionSet,
    pack:
      | { id: string; kind: "builtin" }
      | { id: string; kind: "custom"; createdBy: string }
  ): ObjectCapabilities {
    if (pack.kind === "builtin") {
      return { read: true, write: false, delete: false };
    }
    return ObjectCapabilitiesService.for(set, "toolpack", pack);
  }
}

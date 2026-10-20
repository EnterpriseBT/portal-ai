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
  OBJECT_CONTAINERS,
  SHAREABLE_RESOURCE_TYPES,
  type ContainedType,
  type PartType,
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
/** #829: parts take their entity's capabilities (`attachParts`) and a
 *  contained type's delete folds in its container (`attachContained`), so
 *  tsc refuses either here. */
type NonChildType = Exclude<PermissionResourceType, PartType | ContainedType>;

const SHAREABLE = new Set<string>(SHAREABLE_RESOURCE_TYPES);
const NONE: ObjectCapabilities = { read: false, write: false, delete: false };

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
   * #829: a part has no permission of its own; its capabilities are its
   * entity's, with `delete` = `write` (deleting a part changes the entity's
   * contents). One entity query for the whole page; an unreadable or missing
   * entity gives NONE.
   */
  static async attachParts<T extends OwnedRow>(
    set: PermissionSet,
    organizationId: string,
    partType: PartType,
    rows: T[]
  ): Promise<Array<T & { capabilities: ObjectCapabilities }>> {
    const ownerOf = (row: T) =>
      ParentAccessService.ownerIdOf(partType, row as Record<string, unknown>);
    const caps = await ParentAccessService.ownerCapabilities(
      set,
      organizationId,
      rows.map(ownerOf).filter((id): id is string => id != null)
    );
    return rows.map((row) => {
      const owner = ownerOf(row);
      return {
        ...row,
        capabilities: (owner != null && caps.get(owner)) || NONE,
      };
    });
  }

  /**
   * #829: a contained object (an entity). `read` and `write` are its own;
   * deleting it also needs write on its container. One container query for
   * the whole page.
   */
  static async attachContained<T extends OwnedRow>(
    set: PermissionSet,
    organizationId: string,
    type: ContainedType,
    rows: T[]
  ): Promise<Array<T & { capabilities: ObjectCapabilities }>> {
    const { containerKey } = OBJECT_CONTAINERS[type];
    const containerOf = (row: T) => {
      const v = (row as Record<string, unknown>)[containerKey];
      return typeof v === "string" ? v : null;
    };
    const writable = await ParentAccessService.writableContainerIds(
      set,
      organizationId,
      type,
      rows.map(containerOf).filter((id): id is string => id != null)
    );
    return rows.map((row) => {
      const own = ObjectCapabilitiesService.own(set, type, row);
      const container = containerOf(row);
      return {
        ...row,
        capabilities: {
          read: own.read,
          write: own.write,
          delete: own.delete && container != null && writable.has(container),
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

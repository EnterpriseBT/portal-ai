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
  type PermissionResourceType,
} from "@portalai/core/models";
import type {
  ObjectCapabilities,
  ShareableObjectCapabilities,
} from "@portalai/core/contracts";

import type { PermissionSet } from "./permission-set.js";

interface OwnedRow {
  id: string;
  createdBy: string;
}

type Capabilities = ObjectCapabilities | ShareableObjectCapabilities;

const SHAREABLE = new Set<string>(SHAREABLE_RESOURCE_TYPES);

export class ObjectCapabilitiesService {
  /** The caller's capabilities on one row; `share` iff the type is shareable. */
  static for(
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
    type: PermissionResourceType,
    rows: T[]
  ): Array<T & { capabilities: Capabilities }> {
    return rows.map((row) => ({
      ...row,
      capabilities: ObjectCapabilitiesService.for(set, type, row),
    }));
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

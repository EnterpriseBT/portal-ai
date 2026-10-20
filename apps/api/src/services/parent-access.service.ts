/**
 * #829: objects and parts. A record or field mapping has no permission of its
 * own; its entity's governs it (`PART_OWNERS`). An entity is contained in its
 * connector instance, and creating or deleting one needs write on the
 * instance (`OBJECT_CONTAINERS`). This is the one helper the REST routes,
 * object capabilities and the agent permission gate use to check both.
 *
 * The answer splits as `ObjectAccessService.loadForVerb` does: an object
 * that's missing, in another org or unreadable is absent (404, its own
 * not-found code), and a readable one without the verb is 403.
 *
 * Lookups select only the authorization columns, through the repositories'
 * `findAuthRows`, so a check never decrypts connector credentials.
 */

import { and, eq, isNull, sql, type AnyColumn, type SQL } from "drizzle-orm";

import {
  CHILD_RESOURCE_PARENTS,
  OBJECT_CONTAINERS,
  PART_OWNERS,
  type ChildResourceType,
  type ContainedType,
  type PartType,
  type PermissionResourceType,
} from "@portalai/core/models";
import type { ObjectCapabilities } from "@portalai/core/contracts";

import { ApiCode } from "../constants/api-codes.constants.js";
import { connectorEntities } from "../db/schema/index.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ObjectAccessService } from "./object-access.service.js";
import type { PermissionSet } from "./permission-set.js";

export interface OwnedParentRow {
  id: string;
  organizationId: string;
  createdBy: string;
}

/** The types this service can load: part owners and object containers. */
export type ParentType = "entity" | "connector_instance";

export interface ParentRefusal {
  id: string;
  reason: "not_found" | "denied";
}

const NONE: ObjectCapabilities = { read: false, write: false, delete: false };

const NOT_FOUND: Record<ParentType, () => ApiError> = {
  entity: () =>
    new ApiError(
      404,
      ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
      "Connector entity not found"
    ),
  connector_instance: () =>
    new ApiError(
      404,
      ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
      "Connector instance not found"
    ),
};

const FINDERS: Record<
  ParentType,
  (ids: string[]) => Promise<OwnedParentRow[]>
> = {
  entity: (ids) => DbService.repository.connectorEntities.findAuthRows(ids),
  connector_instance: (ids) =>
    DbService.repository.connectorInstances.findAuthRows(ids),
};

const isParentType = (t: PermissionResourceType): t is ParentType =>
  Object.prototype.hasOwnProperty.call(FINDERS, t);

export class ParentAccessService {
  // ── Parts → owner ─────────────────────────────────────────────────

  /** A part's owner id, from its stored row (or a create's input item). */
  static ownerIdOf(
    partType: PartType,
    row: Record<string, unknown>
  ): string | null {
    const value = row[PART_OWNERS[partType].ownerKey];
    return typeof value === "string" ? value : null;
  }

  /**
   * Check an already loaded entity for a part operation: 404
   * `CONNECTOR_ENTITY_NOT_FOUND` unless in the org and readable, 403
   * `PERMISSION_DENIED` unless `verb` is allowed. Returns the row.
   */
  static assertOwner<T extends OwnedParentRow>(
    set: PermissionSet,
    organizationId: string,
    entity: T | null | undefined,
    verb: "read" | "write"
  ): T {
    if (verb === "read") {
      if (
        !ObjectAccessService.readableInOrg(
          set,
          organizationId,
          "entity",
          entity
        )
      ) {
        throw NOT_FOUND.entity();
      }
      return entity!;
    }
    return ObjectAccessService.loadForVerb(
      set,
      organizationId,
      "entity",
      entity,
      "write",
      NOT_FOUND.entity
    );
  }

  /** Load the entity by id, then {@link assertOwner}. */
  static async loadOwner(
    set: PermissionSet,
    organizationId: string,
    entityId: string,
    verb: "read" | "write"
  ): Promise<OwnedParentRow> {
    const [entity] = await FINDERS.entity([entityId]);
    return ParentAccessService.assertOwner(set, organizationId, entity, verb);
  }

  /**
   * A predicate on a part table's owner column: the part's entity is live, in
   * the org and readable by the caller. For lists of parts that span entities
   * (mappings on a column definition, records across a group's entities).
   */
  static readableOwnerPredicate(
    set: PermissionSet,
    organizationId: string,
    ownerCol: AnyColumn
  ): SQL {
    const visibility = set.visibilityPredicate("entity", {
      createdByCol: connectorEntities.createdBy,
      idCol: connectorEntities.id,
    });
    const where = and(
      eq(connectorEntities.organizationId, organizationId),
      isNull(connectorEntities.deleted),
      visibility
    );
    return sql`${ownerCol} IN (SELECT ${connectorEntities.id} FROM ${connectorEntities} WHERE ${where})`;
  }

  /**
   * The caller's capabilities on each entity id, from one query. A part's
   * capabilities are its owner's, with `delete` = `write` (deleting a part
   * changes the entity's contents). An id that's missing, in another org or
   * unreadable maps to NONE.
   */
  static async ownerCapabilities(
    set: PermissionSet,
    organizationId: string,
    ids: string[]
  ): Promise<Map<string, ObjectCapabilities>> {
    const rows = await ParentAccessService.loadDistinct("entity", ids);
    const caps = new Map<string, ObjectCapabilities>();
    for (const id of new Set(ids)) {
      const row = rows.get(id);
      if (
        !ObjectAccessService.readableInOrg(set, organizationId, "entity", row)
      ) {
        caps.set(id, NONE);
        continue;
      }
      const write = set.can(
        "resource.write",
        ObjectAccessService.object("entity", row!)
      );
      caps.set(id, { read: true, write, delete: write });
    }
    return caps;
  }

  // ── Contained objects → container ─────────────────────────────────

  /** 404 (the container's code) unless readable in the org, 403 unless writable. */
  static assertWritableContainer<T extends OwnedParentRow>(
    set: PermissionSet,
    organizationId: string,
    type: ContainedType,
    container: T | null | undefined
  ): T {
    const containerType = OBJECT_CONTAINERS[type].containerType;
    return ObjectAccessService.loadForVerb(
      set,
      organizationId,
      containerType,
      container,
      "write",
      NOT_FOUND[containerType]
    );
  }

  /** Load the container by id, then {@link assertWritableContainer}. */
  static async loadWritableContainer(
    set: PermissionSet,
    organizationId: string,
    type: ContainedType,
    containerId: string
  ): Promise<OwnedParentRow> {
    const [container] = await FINDERS[OBJECT_CONTAINERS[type].containerType]([
      containerId,
    ]);
    return ParentAccessService.assertWritableContainer(
      set,
      organizationId,
      type,
      container
    );
  }

  /** The container ids among `ids` the caller may write, in one query. */
  static async writableContainerIds(
    set: PermissionSet,
    organizationId: string,
    type: ContainedType,
    ids: string[]
  ): Promise<Set<string>> {
    const containerType = OBJECT_CONTAINERS[type].containerType;
    const rows = await ParentAccessService.loadDistinct(containerType, ids);
    const writable = new Set<string>();
    for (const row of rows.values()) {
      if (
        ObjectAccessService.readableInOrg(
          set,
          organizationId,
          containerType,
          row
        ) &&
        set.can(
          "resource.write",
          ObjectAccessService.object(containerType, row)
        )
      ) {
        writable.add(row.id);
      }
    }
    return writable;
  }

  // ── The gate ──────────────────────────────────────────────────────

  /**
   * For the agent permission gate: the first id (input order) that is
   * missing, in another org or unreadable (`not_found`); failing that, the
   * first the caller can't `verb` (`denied`); else null. Distinct ids, one
   * query. A `not_found` anywhere outranks a `denied`, so a refusal never
   * confirms that an unreadable object exists.
   */
  static async firstRefusal(
    set: PermissionSet,
    organizationId: string,
    type: PermissionResourceType,
    ids: string[],
    verb: "read" | "write"
  ): Promise<ParentRefusal | null> {
    const distinct = [...new Set(ids)];
    if (!isParentType(type)) {
      // Fail closed: a type with no finder can't be checked.
      return distinct.length > 0
        ? { id: distinct[0], reason: "not_found" }
        : null;
    }
    const rows = await ParentAccessService.loadDistinct(type, distinct);
    for (const id of distinct) {
      if (
        !ObjectAccessService.readableInOrg(
          set,
          organizationId,
          type,
          rows.get(id)
        )
      ) {
        return { id, reason: "not_found" };
      }
    }
    if (verb === "write") {
      for (const id of distinct) {
        const row = rows.get(id)!;
        if (!set.can("resource.write", ObjectAccessService.object(type, row))) {
          return { id, reason: "denied" };
        }
      }
    }
    return null;
  }

  // ── Two-layer API, retired by slices 2 and 4 ──────────────────────

  static parentTypeOf(childType: ChildResourceType): ParentType {
    return CHILD_RESOURCE_PARENTS[childType].parentType;
  }

  static parentIdOf(
    childType: ChildResourceType,
    row: Record<string, unknown>
  ): string | null {
    const value = row[CHILD_RESOURCE_PARENTS[childType].parentKey];
    return typeof value === "string" ? value : null;
  }

  static notFound(parentType: ParentType): ApiError {
    return NOT_FOUND[parentType]();
  }

  static assertWritableParent<T extends OwnedParentRow>(
    set: PermissionSet,
    organizationId: string,
    childType: ChildResourceType,
    parent: T | null | undefined
  ): T {
    const parentType = ParentAccessService.parentTypeOf(childType);
    return ObjectAccessService.loadForVerb(
      set,
      organizationId,
      parentType,
      parent,
      "write",
      NOT_FOUND[parentType]
    );
  }

  static async loadWritableParent(
    set: PermissionSet,
    organizationId: string,
    childType: ChildResourceType,
    parentId: string
  ): Promise<OwnedParentRow> {
    const [parent] = await FINDERS[ParentAccessService.parentTypeOf(childType)](
      [parentId]
    );
    return ParentAccessService.assertWritableParent(
      set,
      organizationId,
      childType,
      parent
    );
  }

  static async writableParentIds(
    set: PermissionSet,
    organizationId: string,
    childType: ChildResourceType,
    parentIds: string[]
  ): Promise<Set<string>> {
    const parentType = ParentAccessService.parentTypeOf(childType);
    const rows = await ParentAccessService.loadDistinct(parentType, parentIds);
    const writable = new Set<string>();
    for (const row of rows.values()) {
      if (
        ObjectAccessService.readableInOrg(
          set,
          organizationId,
          parentType,
          row
        ) &&
        set.can("resource.write", ObjectAccessService.object(parentType, row))
      ) {
        writable.add(row.id);
      }
    }
    return writable;
  }

  private static async loadDistinct(
    type: ParentType,
    ids: string[]
  ): Promise<Map<string, OwnedParentRow>> {
    const distinct = [...new Set(ids)];
    if (distinct.length === 0) return new Map();
    const rows = await FINDERS[type](distinct);
    return new Map(rows.map((r) => [r.id, r]));
  }
}

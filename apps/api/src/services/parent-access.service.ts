/**
 * #829: a child write requires write on its parent. Read means read only:
 * creating, updating or deleting a field mapping or record needs `write` on
 * its entity, and an entity needs `write` on its connector instance. The
 * pairing lives in core's `CHILD_RESOURCE_PARENTS`; this is the one helper the
 * REST routes, object capabilities and the agent permission gate use to check
 * it.
 *
 * The answer splits as `ObjectAccessService.loadForVerb` does: a parent that's
 * missing, in another org or unreadable is absent (404, the parent's own
 * not-found code), and a readable one the caller can't write is 403.
 */

import { inArray } from "drizzle-orm";

import {
  CHILD_RESOURCE_PARENTS,
  type ChildResourceType,
  type PermissionResourceType,
} from "@portalai/core/models";

import { ApiCode } from "../constants/api-codes.constants.js";
import { connectorEntities, connectorInstances } from "../db/schema/index.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ObjectAccessService } from "./object-access.service.js";
import type { PermissionSet } from "./permission-set.js";

export interface OwnedParentRow {
  id: string;
  organizationId: string;
  createdBy: string;
}

export type ParentType =
  (typeof CHILD_RESOURCE_PARENTS)[ChildResourceType]["parentType"];

export interface ParentRefusal {
  id: string;
  reason: "not_found" | "denied";
}

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
  {
    one: (id: string) => Promise<OwnedParentRow | undefined>;
    many: (ids: string[]) => Promise<OwnedParentRow[]>;
  }
> = {
  entity: {
    one: (id) => DbService.repository.connectorEntities.findById(id),
    many: (ids) =>
      DbService.repository.connectorEntities.findMany(
        inArray(connectorEntities.id, ids)
      ),
  },
  connector_instance: {
    one: (id) => DbService.repository.connectorInstances.findById(id),
    many: (ids) =>
      DbService.repository.connectorInstances.findMany(
        inArray(connectorInstances.id, ids)
      ),
  },
};

const isParentType = (t: PermissionResourceType): t is ParentType =>
  t in FINDERS;

export class ParentAccessService {
  /** The parent type of a child type. */
  static parentTypeOf(childType: ChildResourceType): ParentType {
    return CHILD_RESOURCE_PARENTS[childType].parentType;
  }

  /** The parent's id on a child row (or a create's input item). */
  static parentIdOf(
    childType: ChildResourceType,
    row: Record<string, unknown>
  ): string | null {
    const value = row[CHILD_RESOURCE_PARENTS[childType].parentKey];
    return typeof value === "string" ? value : null;
  }

  /** The parent's 404, for a route that answers before it has the row. */
  static notFound(parentType: ParentType): ApiError {
    return NOT_FOUND[parentType]();
  }

  /**
   * Check an already loaded parent row: 404 (the parent's code) unless it is
   * in the org and readable, 403 `PERMISSION_DENIED` unless writable. Returns
   * the row.
   */
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

  /** Load the parent by id, then `assertWritableParent`. */
  static async loadWritableParent(
    set: PermissionSet,
    organizationId: string,
    childType: ChildResourceType,
    parentId: string
  ): Promise<OwnedParentRow> {
    const parentType = ParentAccessService.parentTypeOf(childType);
    const parent = await FINDERS[parentType].one(parentId);
    return ParentAccessService.assertWritableParent(
      set,
      organizationId,
      childType,
      parent
    );
  }

  /**
   * The ids among `parentIds` the caller may write (in org, readable,
   * writable), in one query. Object capabilities use it per page.
   */
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

  /**
   * For the agent permission gate: the first id (input order) that is
   * missing, in another org or unreadable (`not_found`); failing that, the
   * first the caller can't `verb` (`denied`); else null. Distinct ids, one
   * query. A `not_found` anywhere outranks a `denied`, so a refusal never
   * confirms that an unreadable parent exists.
   */
  static async firstRefusal(
    set: PermissionSet,
    organizationId: string,
    parentType: PermissionResourceType,
    ids: string[],
    verb: "read" | "write"
  ): Promise<ParentRefusal | null> {
    const distinct = [...new Set(ids)];
    if (!isParentType(parentType)) {
      // Fail closed: a type with no finder can't be checked.
      return distinct.length > 0
        ? { id: distinct[0], reason: "not_found" }
        : null;
    }
    const rows = await ParentAccessService.loadDistinct(parentType, distinct);
    for (const id of distinct) {
      if (
        !ObjectAccessService.readableInOrg(
          set,
          organizationId,
          parentType,
          rows.get(id)
        )
      ) {
        return { id, reason: "not_found" };
      }
    }
    if (verb === "write") {
      for (const id of distinct) {
        const row = rows.get(id)!;
        if (
          !set.can(
            "resource.write",
            ObjectAccessService.object(parentType, row)
          )
        ) {
          return { id, reason: "denied" };
        }
      }
    }
    return null;
  }

  private static async loadDistinct(
    parentType: ParentType,
    ids: string[]
  ): Promise<Map<string, OwnedParentRow>> {
    const distinct = [...new Set(ids)];
    if (distinct.length === 0) return new Map();
    const rows = await FINDERS[parentType].many(distinct);
    return new Map(rows.map((r) => [r.id, r]));
  }
}

/**
 * The objects a user can act on by type and id: tags (#1070) and favorites
 * (#1072) both name an object as `{ type, id }` and check it the same way.
 *
 * Each type loads through its repository and answers its own not-found
 * code. {@link ObjectTargetService.loadReadable} is the one read rule: the
 * object must be live, in the caller's org and readable, else that 404
 * (unreadable == absent).
 */

import type { TagTarget, TagTargetType } from "@portalai/core/models";

import { ApiCode } from "../constants/api-codes.constants.js";
import { DbService } from "./db.service.js";
import { ApiError } from "./http.service.js";
import { ObjectAccessService, type OwnedRow } from "./object-access.service.js";
import type { PermissionSet } from "./permission-set.js";
import type { PermissionContext } from "./permission.service.js";

export interface TargetDescriptor {
  load: (id: string) => Promise<OwnedRow | null | undefined>;
  notFound: () => ApiError;
}

const OBJECT_TARGETS: Record<TagTargetType, TargetDescriptor> = {
  entity: {
    load: (id) => DbService.repository.connectorEntities.findById(id),
    notFound: () =>
      new ApiError(
        404,
        ApiCode.CONNECTOR_ENTITY_NOT_FOUND,
        "Connector entity not found"
      ),
  },
  station: {
    load: (id) => DbService.repository.stations.findById(id),
    notFound: () =>
      new ApiError(404, ApiCode.STATION_NOT_FOUND, "Station not found"),
  },
  pin: {
    load: (id) => DbService.repository.portalResults.findById(id),
    notFound: () =>
      new ApiError(
        404,
        ApiCode.PORTAL_RESULT_NOT_FOUND,
        "Portal result not found"
      ),
  },
  connector_instance: {
    load: (id) => DbService.repository.connectorInstances.findById(id),
    notFound: () =>
      new ApiError(
        404,
        ApiCode.CONNECTOR_INSTANCE_NOT_FOUND,
        "Connector instance not found"
      ),
  },
  curated_view: {
    load: (id) => DbService.repository.curatedViews.findById(id),
    notFound: () =>
      new ApiError(404, ApiCode.CURATED_VIEW_NOT_FOUND, "View not found"),
  },
};

export class ObjectTargetService {
  /** The loader and not-found error for one object type. */
  static descriptor(type: TagTargetType): TargetDescriptor {
    return OBJECT_TARGETS[type];
  }

  /**
   * Load the object for a caller who must be able to read it. Throws the
   * type's own 404 when it's missing, deleted, in another org or unreadable.
   * Each target type is the permission resource type of its own name.
   */
  static async loadReadable(
    set: PermissionSet,
    ctx: PermissionContext,
    target: TagTarget
  ): Promise<OwnedRow> {
    const descriptor = OBJECT_TARGETS[target.type];
    const row = await descriptor.load(target.id);
    if (
      !row ||
      !ObjectAccessService.readableInOrg(
        set,
        ctx.organizationId,
        target.type,
        row
      )
    ) {
      throw descriptor.notFound();
    }
    return row;
  }
}

import type {
  EntityTagAssignmentCreateRequestBody,
  EntityTagAssignmentCreateResponsePayload,
  EntityTagAssignmentListResponsePayload,
} from "@portalai/core/contracts";
import type { TagTarget, TagTargetType } from "@portalai/core/models";

import { useAuthMutation, useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import type { QueryOptions } from "./types";
import { queryKeys } from "./keys";

/** The API collection each taggable type lives under (#1070). */
export const TAG_TARGET_PATH: Record<TagTargetType, string> = {
  entity: "connector-entities",
  station: "stations",
  pin: "portal-results",
  connector_instance: "connector-instances",
  curated_view: "curated-views",
};

/** The query-key root of each taggable type: its rows carry their tags. */
export function tagTargetRootKey(type: TagTargetType) {
  switch (type) {
    case "entity":
      return queryKeys.connectorEntities.root;
    case "station":
      return queryKeys.stations.root;
    case "pin":
      return queryKeys.portalResults.root;
    case "connector_instance":
      return queryKeys.connectorInstances.root;
    case "curated_view":
      return queryKeys.curatedViews.root;
  }
}

const tagsUrl = ({ type, id }: TagTarget) =>
  `/api/${TAG_TARGET_PATH[type]}/${encodeURIComponent(id)}/tags`;

/**
 * Tags on one object (#1070). Every taggable type answers the same way, so
 * one module serves them all.
 */
export const tagAssignments = {
  list: (
    target: TagTarget,
    options?: QueryOptions<EntityTagAssignmentListResponsePayload>
  ) =>
    useAuthQuery<EntityTagAssignmentListResponsePayload>(
      queryKeys.tagAssignments.listByTarget(target.type, target.id),
      buildUrl(tagsUrl(target)),
      undefined,
      options
    ),

  assign: (target: TagTarget) =>
    useAuthMutation<
      EntityTagAssignmentCreateResponsePayload,
      EntityTagAssignmentCreateRequestBody
    >({
      url: tagsUrl(target),
      method: "POST",
      // #689: tagging is a write on the object; a 403 or 404 refetches the
      // object (whose capabilities gate it) and its tags.
      onPermissionDenied: {
        invalidate: () => [
          tagTargetRootKey(target.type),
          queryKeys.tagAssignments.root,
        ],
      },
    }),

  unassign: (target: TagTarget) =>
    useAuthMutation<void, { assignmentId: string }>({
      url: ({ assignmentId }) =>
        `${tagsUrl(target)}/${encodeURIComponent(assignmentId)}`,
      method: "DELETE",
      body: () => undefined,
      onPermissionDenied: {
        invalidate: () => [
          tagTargetRootKey(target.type),
          queryKeys.tagAssignments.root,
        ],
      },
    }),
};

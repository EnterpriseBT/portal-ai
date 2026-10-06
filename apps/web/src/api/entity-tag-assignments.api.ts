import type {
  EntityTagAssignmentCreateRequestBody,
  EntityTagAssignmentCreateResponsePayload,
  EntityTagAssignmentListResponsePayload,
} from "@portalai/core/contracts";
import { useAuthMutation, useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import type { QueryOptions } from "./types";
import { queryKeys } from "./keys";

const entityTagAssignmentUrl = (connectorEntityId: string) =>
  `/api/connector-entities/${encodeURIComponent(connectorEntityId)}/tags`;

export const entityTagAssignments = {
  listByEntity: (
    connectorEntityId: string,
    options?: QueryOptions<EntityTagAssignmentListResponsePayload>
  ) =>
    useAuthQuery<EntityTagAssignmentListResponsePayload>(
      queryKeys.entityTagAssignments.listByEntity(connectorEntityId),
      buildUrl(entityTagAssignmentUrl(connectorEntityId)),
      undefined,
      options
    ),

  assign: (connectorEntityId: string) =>
    useAuthMutation<
      EntityTagAssignmentCreateResponsePayload,
      EntityTagAssignmentCreateRequestBody
    >({
      url: entityTagAssignmentUrl(connectorEntityId),
      method: "POST",
      // #689: tag assignment is an entity write; a 403 refetches the entity
      // (whose capabilities gate it) and its tags.
      onPermissionDenied: {
        invalidate: () => [
          queryKeys.connectorEntities.root,
          queryKeys.entityTagAssignments.root,
        ],
      },
    }),

  unassign: (connectorEntityId: string) =>
    useAuthMutation<void, { assignmentId: string }>({
      url: ({ assignmentId }) =>
        `${entityTagAssignmentUrl(connectorEntityId)}/${encodeURIComponent(assignmentId)}`,
      method: "DELETE",
      body: () => undefined,
      // #689: tag assignment is an entity write; a 403 refetches the entity
      // (whose capabilities gate it) and its tags.
      onPermissionDenied: {
        invalidate: () => [
          queryKeys.connectorEntities.root,
          queryKeys.entityTagAssignments.root,
        ],
      },
    }),
};

import type {
  EntityTagAssignmentCreateRequestBody,
  EntityTagAssignmentCreateResponsePayload,
  EntityTagAssignmentListResponsePayload,
} from "@portalai/core/contracts";
import { useMutation } from "@tanstack/react-query";
import { useAuthFetch, useAuthMutation, useAuthQuery } from "../utils/api.util";
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
    }),

  unassign: (connectorEntityId: string) => {
    const { fetchWithAuth } = useAuthFetch();

    return useMutation<void, unknown, { assignmentId: string }>({
      mutationFn: async ({ assignmentId }) => {
        await fetchWithAuth(
          `${entityTagAssignmentUrl(connectorEntityId)}/${encodeURIComponent(assignmentId)}`,
          { method: "DELETE" }
        );
      },
    });
  },
};

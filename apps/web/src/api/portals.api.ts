import type {
  PortalListRequestQuery,
  PortalGetRequestQuery,
  PortalListResponsePayload,
  PortalGetResponsePayload,
  PortalCreateResponsePayload,
  CreatePortalBody,
  SendMessageBody,
  UpdatePortalBody,
} from "@portalai/core/contracts";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const portals = {
  list: (
    params?: PortalListRequestQuery,
    options?: QueryOptions<PortalListResponsePayload>
  ) =>
    useAuthQuery<PortalListResponsePayload>(
      queryKeys.portals.list(params),
      buildUrl("/api/portals", params),
      undefined,
      options
    ),

  get: (
    id: string,
    params?: PortalGetRequestQuery,
    options?: QueryOptions<PortalGetResponsePayload>
  ) =>
    useAuthQuery<PortalGetResponsePayload>(
      queryKeys.portals.get(id, params),
      buildUrl(`/api/portals/${encodeURIComponent(id)}`, params),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<PortalCreateResponsePayload, CreatePortalBody>({
      url: "/api/portals",
    }),

  sendMessage: (portalId: string) =>
    useAuthMutation<void, SendMessageBody>({
      url: `/api/portals/${encodeURIComponent(portalId)}/messages`,
      // #699: a 404 STATION_NOT_FOUND means the portal's station is gone for
      // the caller; refetching it locks the composer with the reason.
      onPermissionDenied: {
        invalidate: () => [queryKeys.portals.root, queryKeys.stations.root],
      },
    }),

  rename: (id: string) =>
    useAuthMutation<
      { portal: { id: string; name: string } },
      Required<Pick<UpdatePortalBody, "name">>
    >({
      url: `/api/portals/${encodeURIComponent(id)}`,
      method: "PATCH",
      // #690: a 403 means the caller's capabilities changed; refetch them.
      onPermissionDenied: { invalidate: () => [queryKeys.portals.root] },
    }),

  remove: (id: string) =>
    useAuthMutation<{ id: string }, void>({
      url: `/api/portals/${encodeURIComponent(id)}`,
      method: "DELETE",
      onPermissionDenied: { invalidate: () => [queryKeys.portals.root] },
    }),

  resetMessages: (portalId: string) =>
    useAuthMutation<void, void>({
      url: `/api/portals/${encodeURIComponent(portalId)}/messages`,
      method: "DELETE",
      onPermissionDenied: { invalidate: () => [queryKeys.portals.root] },
    }),

  touch: (id: string) =>
    useAuthMutation<
      { portal: { id: string } },
      Required<Pick<UpdatePortalBody, "lastOpened">>
    >({
      url: `/api/portals/${encodeURIComponent(id)}`,
      method: "PATCH",
      onPermissionDenied: { invalidate: () => [queryKeys.portals.root] },
    }),

  /**
   * Non-terminal jobs whose metadata declares this portal id (#85
   * Phase 2 slice 3). The chat-input lock derives from this query —
   * empty array → input enabled.
   */
  runningJobs: (portalId: string) =>
    useAuthQuery<{
      jobs: Array<{
        id: string;
        type: string;
        status: string;
        startedAt: number | null;
        created: number;
      }>;
    }>(
      queryKeys.portals.runningJobs(portalId),
      `/api/portals/${encodeURIComponent(portalId)}/running-jobs`
    ),
};

import type {
  PortalListRequestQuery,
  PortalGetRequestQuery,
  PortalListResponsePayload,
  PortalGetResponsePayload,
  PortalCreateResponsePayload,
  CreatePortalBody,
  SendMessageBody,
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
    options?: QueryOptions<PortalGetResponsePayload>,
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
    }),

  rename: (id: string) =>
    useAuthMutation<{ portal: { id: string; name: string } }, { name: string }>({
      url: `/api/portals/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  remove: (id: string) =>
    useAuthMutation<{ id: string }, void>({
      url: `/api/portals/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  resetMessages: (portalId: string) =>
    useAuthMutation<void, void>({
      url: `/api/portals/${encodeURIComponent(portalId)}/messages`,
      method: "DELETE",
    }),

  touch: (id: string) =>
    useAuthMutation<{ portal: { id: string } }, { lastOpened: number }>({
      url: `/api/portals/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),
};

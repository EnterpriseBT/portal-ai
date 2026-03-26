import type {
  PortalListRequestQuery,
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

  get: (id: string, options?: QueryOptions<PortalGetResponsePayload>) =>
    useAuthQuery<PortalGetResponsePayload>(
      queryKeys.portals.get(id),
      buildUrl(`/api/portals/${encodeURIComponent(id)}`),
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

  resetMessages: (portalId: string) =>
    useAuthMutation<void, void>({
      url: `/api/portals/${encodeURIComponent(portalId)}/messages`,
      method: "DELETE",
    }),
};

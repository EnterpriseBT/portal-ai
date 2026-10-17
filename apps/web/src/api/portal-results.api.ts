import type {
  PinResultBody,
  PortalResultGetResponsePayload,
  PortalResultListResponsePayload,
  PinDataResponse,
  UpdatePortalResultBody,
} from "@portalai/core/contracts";
import { VIZ_REFRESH_FRESHNESS_MS } from "@portalai/core/constants";
import type { PortalResult } from "@portalai/core/models";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { isPinDataRefusal } from "../utils/pin-data.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export type PortalResultsListParams = {
  stationId?: string;
  portalId?: string;
  search?: string;
  limit?: number;
  offset?: number;
  include?: string;
};

/** #688: the list and GET are typed by the core contracts; each pin carries
 *  the caller's `capabilities` (share/write/delete) on it. */
export type PortalResultsListPayload = PortalResultListResponsePayload;
export type PortalResultPayload = PortalResultGetResponsePayload;

/** What pin/rename return: the row, without capabilities. */
export interface PortalResultMutationPayload {
  portalResult: PortalResult;
}

export const portalResults = {
  list: (
    params?: PortalResultsListParams,
    options?: QueryOptions<PortalResultsListPayload>
  ) =>
    useAuthQuery<PortalResultsListPayload>(
      queryKeys.portalResults.list(params),
      buildUrl("/api/portal-results", params),
      undefined,
      options
    ),

  get: (id: string, options?: QueryOptions<PortalResultPayload>) =>
    useAuthQuery<PortalResultPayload>(
      queryKeys.portalResults.get(id),
      buildUrl(`/api/portal-results/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  /**
   * #640: a pin's data, live, as its definer sees it (the pin stores none).
   * Cached for the widget freshness window, so revisiting a pin within it
   * doesn't re-run its query. A refusal the pin's state explains (no stored
   * query, a definer who lost access) isn't retried.
   */
  data: (id: string, options?: QueryOptions<PinDataResponse>) =>
    useAuthQuery<PinDataResponse>(
      queryKeys.portalResults.data(id),
      buildUrl(`/api/portal-results/${encodeURIComponent(id)}/data`),
      undefined,
      {
        staleTime: VIZ_REFRESH_FRESHNESS_MS,
        retry: (failureCount, error) =>
          !isPinDataRefusal(error) && failureCount < 3,
        ...options,
      }
    ),

  pin: () =>
    useAuthMutation<PortalResultMutationPayload, PinResultBody>({
      url: "/api/portal-results",
    }),

  rename: (id: string) =>
    useAuthMutation<PortalResultMutationPayload, UpdatePortalResultBody>({
      url: `/api/portal-results/${encodeURIComponent(id)}`,
      method: "PATCH",
      onPermissionDenied: { invalidate: () => [queryKeys.portalResults.root] },
    }),

  /**
   * Unpin (delete) a portal result. The id travels in the mutation
   * variables rather than being bound at hook-creation time: `PortalMessage`
   * renders many blocks whose pinned ids differ, so the id is only known at
   * click time. `rename` keeps the bound-id shape — its caller has a single
   * known id.
   */
  remove: () =>
    useAuthMutation<{ id: string }, { id: string }>({
      url: ({ id }) => `/api/portal-results/${encodeURIComponent(id)}`,
      method: "DELETE",
      body: () => undefined,
      onPermissionDenied: { invalidate: () => [queryKeys.portalResults.root] },
    }),
};

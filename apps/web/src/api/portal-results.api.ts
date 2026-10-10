import type {
  PinResultBody,
  PortalResultGetResponsePayload,
  PortalResultListResponsePayload,
  WidgetRefreshResponse,
} from "@portalai/core/contracts";
import type { PortalResult } from "@portalai/core/models";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
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

export interface RenamePortalResultBody {
  name: string;
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

  pin: () =>
    useAuthMutation<PortalResultMutationPayload, PinResultBody>({
      url: "/api/portal-results",
    }),

  rename: (id: string) =>
    useAuthMutation<PortalResultMutationPayload, RenamePortalResultBody>({
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

  /**
   * Re-execute a pinned result's durable pipeline for live data (#312).
   * Id-in-variables like `remove` — the widget-refresh hook serves many
   * refs. The server persists the fresh snapshot back onto the row, so
   * consumers should invalidate `queryKeys.portalResults.get(id)` on
   * success.
   */
  refresh: () =>
    useAuthMutation<WidgetRefreshResponse, { id: string }>({
      url: ({ id }) => `/api/portal-results/${encodeURIComponent(id)}/refresh`,
      body: () => undefined,
      // #753: a manual refresh must not join an auto-refresh in flight.
      dedupeInFlight: false,
      onPermissionDenied: { invalidate: () => [queryKeys.portalResults.root] },
    }),
};

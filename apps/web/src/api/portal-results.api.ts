import type { PinResultBody } from "@portalai/core/contracts";

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
};

export interface PortalResultsListPayload {
  portalResults: unknown[];
  total: number;
  limit: number;
  offset: number;
}

export interface PortalResultPayload {
  portalResult: unknown;
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
    useAuthMutation<PortalResultPayload, PinResultBody>({
      url: "/api/portal-results",
    }),

  rename: (id: string) =>
    useAuthMutation<PortalResultPayload, RenamePortalResultBody>({
      url: `/api/portal-results/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  remove: (id: string) =>
    useAuthMutation<{ id: string }, void>({
      url: `/api/portal-results/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),
};

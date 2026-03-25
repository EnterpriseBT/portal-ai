import type {
  StationListRequestQuery,
  StationListResponsePayload,
  StationGetResponsePayload,
  StationCreateResponsePayload,
  StationUpdateResponsePayload,
  CreateStationBody,
  UpdateStationBody,
} from "@portalai/core/contracts";
import type { OrganizationGetResponse } from "@portalai/core/contracts";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const stations = {
  list: (
    params?: StationListRequestQuery,
    options?: QueryOptions<StationListResponsePayload>
  ) =>
    useAuthQuery<StationListResponsePayload>(
      queryKeys.stations.list(params),
      buildUrl("/api/stations", params),
      undefined,
      options
    ),

  get: (id: string, options?: QueryOptions<StationGetResponsePayload>) =>
    useAuthQuery<StationGetResponsePayload>(
      queryKeys.stations.get(id),
      buildUrl(`/api/stations/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<StationCreateResponsePayload, CreateStationBody>({
      url: "/api/stations",
    }),

  update: (id: string) =>
    useAuthMutation<StationUpdateResponsePayload, UpdateStationBody>({
      url: `/api/stations/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  setDefault: (orgId: string) =>
    useAuthMutation<OrganizationGetResponse, { defaultStationId: string | null }>({
      url: `/api/organization/${encodeURIComponent(orgId)}`,
      method: "PATCH",
    }),
};

import type {
  StationToolListRequestQuery,
  StationToolListResponsePayload,
  StationToolAssignResponsePayload,
  AssignStationToolBody,
} from "@portalai/core/contracts";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const stationTools = {
  list: (
    stationId: string,
    params?: StationToolListRequestQuery,
    options?: QueryOptions<StationToolListResponsePayload>
  ) =>
    useAuthQuery<StationToolListResponsePayload>(
      queryKeys.stationTools.list(stationId, params),
      buildUrl(`/api/stations/${encodeURIComponent(stationId)}/tools`, params),
      undefined,
      options
    ),

  assign: (stationId: string) =>
    useAuthMutation<StationToolAssignResponsePayload, AssignStationToolBody>({
      url: `/api/stations/${encodeURIComponent(stationId)}/tools`,
    }),

  unassign: (stationId: string, assignmentId: string) =>
    useAuthMutation<{ id: string }, void>({
      url: `/api/stations/${encodeURIComponent(stationId)}/tools/${encodeURIComponent(assignmentId)}`,
      method: "DELETE",
    }),
};

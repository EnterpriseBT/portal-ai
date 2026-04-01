import type {
  ConnectorEntityGetResponsePayload,
  ConnectorEntityImpactResponsePayload,
  ConnectorEntityListRequestQuery,
  ConnectorEntityListResponsePayload,
  ConnectorEntityListWithMappingsResponsePayload,
  ConnectorEntityPatchRequestBody,
  ConnectorEntityPatchResponsePayload,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const connectorEntities = {
  list: (
    params?: ConnectorEntityListRequestQuery,
    options?: QueryOptions<ConnectorEntityListResponsePayload | ConnectorEntityListWithMappingsResponsePayload>
  ) =>
    useAuthQuery<ConnectorEntityListResponsePayload | ConnectorEntityListWithMappingsResponsePayload>(
      queryKeys.connectorEntities.list(params),
      buildUrl("/api/connector-entities", params),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ConnectorEntityGetResponsePayload>
  ) =>
    useAuthQuery<ConnectorEntityGetResponsePayload>(
      queryKeys.connectorEntities.get(id),
      buildUrl(`/api/connector-entities/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<ConnectorEntityImpactResponsePayload>
  ) =>
    useAuthQuery<ConnectorEntityImpactResponsePayload>(
      queryKeys.connectorEntities.impact(id),
      buildUrl(`/api/connector-entities/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  update: (id: string) =>
    useAuthMutation<ConnectorEntityPatchResponsePayload, ConnectorEntityPatchRequestBody>({
      url: `/api/connector-entities/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `/api/connector-entities/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),
};

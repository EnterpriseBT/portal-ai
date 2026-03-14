import type {
  ConnectorDefinitionGetResponsePayload,
  ConnectorDefinitionListRequestQuery,
  ConnectorDefinitionListResponsePayload,
} from "@portalai/core/contracts";
import { useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const connectorDefinitions = {
  list: (
    params?: ConnectorDefinitionListRequestQuery,
    options?: QueryOptions<ConnectorDefinitionListResponsePayload>
  ) =>
    useAuthQuery<ConnectorDefinitionListResponsePayload>(
      queryKeys.connectorDefinitions.list(params),
      buildUrl("/api/connector-definitions", params),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ConnectorDefinitionGetResponsePayload>
  ) =>
    useAuthQuery<ConnectorDefinitionGetResponsePayload>(
      queryKeys.connectorDefinitions.get(id),
      buildUrl(`/api/connector-definitions/${encodeURIComponent(id)}`),
      undefined,
      options
    ),
};

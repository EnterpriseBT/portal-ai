import type {
  ConnectorEntityGetResponsePayload,
  ConnectorEntityListRequestQuery,
  ConnectorEntityListResponsePayload,
  ConnectorEntityListWithMappingsResponsePayload,
} from "@portalai/core/contracts";
import { useAuthQuery } from "../utils/api.util";
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
};

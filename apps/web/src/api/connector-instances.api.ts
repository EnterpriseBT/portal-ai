import type {
  ConnectorInstanceGetResponsePayload,
  ConnectorInstanceListRequestQuery,
  ConnectorInstanceListResponsePayload,
  ConnectorInstanceListWithDefinitionResponsePayload,
} from "@portalai/core/contracts";
import { useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const connectorInstances = {
  list: (
    params?: ConnectorInstanceListRequestQuery,
    options?: QueryOptions<ConnectorInstanceListResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceListResponsePayload>(
      queryKeys.connectorInstances.list(params),
      buildUrl("/api/connector-instances", params),
      undefined,
      options
    ),

  listWithDefinition: (
    params?: ConnectorInstanceListRequestQuery,
    options?: QueryOptions<ConnectorInstanceListWithDefinitionResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceListWithDefinitionResponsePayload>(
      queryKeys.connectorInstances.list(params),
      buildUrl("/api/connector-instances", { ...params, include: "connectorDefinition" }),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ConnectorInstanceGetResponsePayload>
  ) =>
    useAuthQuery<ConnectorInstanceGetResponsePayload>(
      queryKeys.connectorInstances.get(id),
      buildUrl(`/api/connector-instances/${encodeURIComponent(id)}`),
      undefined,
      options
    ),
};

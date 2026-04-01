import type {
  ColumnDefinitionGetResponsePayload,
  ColumnDefinitionImpactResponsePayload,
  ColumnDefinitionListRequestQuery,
  ColumnDefinitionListResponsePayload,
  ColumnDefinitionUpdateRequestBody,
  ColumnDefinitionUpdateResponsePayload,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const columnDefinitions = {
  list: (
    params?: ColumnDefinitionListRequestQuery,
    options?: QueryOptions<ColumnDefinitionListResponsePayload>
  ) =>
    useAuthQuery<ColumnDefinitionListResponsePayload>(
      queryKeys.columnDefinitions.list(params),
      buildUrl("/api/column-definitions", params),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ColumnDefinitionGetResponsePayload>
  ) =>
    useAuthQuery<ColumnDefinitionGetResponsePayload>(
      queryKeys.columnDefinitions.get(id),
      buildUrl(`/api/column-definitions/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<ColumnDefinitionImpactResponsePayload>
  ) =>
    useAuthQuery<ColumnDefinitionImpactResponsePayload>(
      queryKeys.columnDefinitions.impact(id),
      buildUrl(`/api/column-definitions/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  update: (id: string) =>
    useAuthMutation<ColumnDefinitionUpdateResponsePayload, ColumnDefinitionUpdateRequestBody>({
      url: `/api/column-definitions/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `/api/column-definitions/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),
};

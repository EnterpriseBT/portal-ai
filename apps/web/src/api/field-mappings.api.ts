import { useMemo } from "react";

import type {
  ApiSuccessResponse,
  FieldMappingListRequestQuery,
  FieldMappingListResponsePayload,
  FieldMappingListWithConnectorEntityResponsePayload,
  FieldMappingListWithColumnDefinitionResponsePayload,
  FieldMappingBidirectionalValidationResponsePayload,
  FieldMappingImpactResponsePayload,
  FieldMappingCreateRequestBody,
  FieldMappingCreateResponsePayload,
  FieldMappingUpdateRequestBody,
  FieldMappingUpdateResponsePayload,
  FieldMappingWithConnectorEntity,
  FieldMappingWithColumnDefinition,
} from "@portalai/core/contracts";
import { useAsyncFilterOptions } from "@portalai/core/ui";
import type { AsyncFilterOptionsConfig } from "@portalai/core/ui";
import { useAuthQuery, useAuthMutation, useAuthFetch } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

/** Search field mappings with `include=connectorEntity` — label shows `sourceField (entityLabel)`. */
export function useFieldMappingWithEntitySearch(options?: {
  defaultParams?: Record<string, string>;
}) {
  const { fetchWithAuth } = useAuthFetch();

  const config = useMemo<
    AsyncFilterOptionsConfig<
      ApiSuccessResponse<FieldMappingListWithConnectorEntityResponsePayload>,
      FieldMappingWithConnectorEntity
    >
  >(
    () => ({
      url: "/api/field-mappings",
      fetcher: fetchWithAuth,
      getItems: (res) => res.payload.fieldMappings,
      mapItem: (fm) => ({
        value: fm.id,
        label: fm.connectorEntity
          ? `${fm.sourceField} (${fm.connectorEntity.label})`
          : fm.sourceField,
      }),
      defaultParams: { include: "connectorEntity", ...options?.defaultParams },
    }),
    [fetchWithAuth, options]
  );

  return useAsyncFilterOptions(config);
}

/** Search field mappings with `include=columnDefinition` — label shows columnDefinition label or sourceField. */
export function useFieldMappingWithColumnDefinitionSearch(options?: {
  defaultParams?: Record<string, string>;
}) {
  const { fetchWithAuth } = useAuthFetch();

  const config = useMemo<
    AsyncFilterOptionsConfig<
      ApiSuccessResponse<FieldMappingListWithColumnDefinitionResponsePayload>,
      FieldMappingWithColumnDefinition
    >
  >(
    () => ({
      url: "/api/field-mappings",
      fetcher: fetchWithAuth,
      getItems: (res) => res.payload.fieldMappings,
      mapItem: (fm) => ({
        value: fm.id,
        label: fm.columnDefinition?.label ?? fm.sourceField,
      }),
      defaultParams: {
        include: "columnDefinition",
        ...options?.defaultParams,
      },
    }),
    [fetchWithAuth, options]
  );

  return useAsyncFilterOptions(config);
}

export const fieldMappings = {
  list: <
    T extends
      | FieldMappingListResponsePayload
      | FieldMappingListWithConnectorEntityResponsePayload =
      FieldMappingListResponsePayload,
  >(
    params?: FieldMappingListRequestQuery,
    options?: QueryOptions<T>
  ) =>
    useAuthQuery<T>(
      queryKeys.fieldMappings.list(params),
      buildUrl("/api/field-mappings", params),
      undefined,
      options
    ),

  validateBidirectional: (
    id: string,
    options?: QueryOptions<FieldMappingBidirectionalValidationResponsePayload>
  ) =>
    useAuthQuery<FieldMappingBidirectionalValidationResponsePayload>(
      queryKeys.fieldMappings.validateBidirectional(id),
      buildUrl(`/api/field-mappings/${encodeURIComponent(id)}/validate-bidirectional`),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<FieldMappingImpactResponsePayload>
  ) =>
    useAuthQuery<FieldMappingImpactResponsePayload>(
      queryKeys.fieldMappings.impact(id),
      buildUrl(`/api/field-mappings/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<FieldMappingCreateResponsePayload, FieldMappingCreateRequestBody>({
      url: "/api/field-mappings",
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<FieldMappingUpdateResponsePayload, FieldMappingUpdateRequestBody>({
      url: `/api/field-mappings/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `/api/field-mappings/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),
};

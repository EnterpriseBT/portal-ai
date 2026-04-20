import { useMemo } from "react";

import type {
  ApiSuccessResponse,
  FieldMappingListRequestQuery,
  FieldMappingListResponsePayload,
  FieldMappingListWithConnectorEntityResponsePayload,
  FieldMappingListWithColumnDefinitionResponsePayload,
  FieldMappingBidirectionalValidationResponsePayload,
  FieldMappingGetResponsePayload,
  FieldMappingImpactResponsePayload,
  FieldMappingCreateRequestBody,
  FieldMappingCreateResponsePayload,
  FieldMappingUpdateRequestBody,
  FieldMappingUpdateResponsePayload,
  FieldMappingWithConnectorEntity,
  FieldMappingWithColumnDefinition,
} from "@portalai/core/contracts";
import { useAsyncFilterOptions } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import { useAuthQuery, useAuthMutation, useAuthFetch } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions, SearchHookOptions } from "./types";

const FIELD_MAPPINGS_URL = "/api/field-mappings";

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
      buildUrl(FIELD_MAPPINGS_URL, params),
      undefined,
      options
    ),

  validateBidirectional: (
    id: string,
    options?: QueryOptions<FieldMappingBidirectionalValidationResponsePayload>
  ) =>
    useAuthQuery<FieldMappingBidirectionalValidationResponsePayload>(
      queryKeys.fieldMappings.validateBidirectional(id),
      buildUrl(
        `${FIELD_MAPPINGS_URL}/${encodeURIComponent(id)}/validate-bidirectional`
      ),
      undefined,
      options
    ),

  impact: (
    id: string,
    options?: QueryOptions<FieldMappingImpactResponsePayload>
  ) =>
    useAuthQuery<FieldMappingImpactResponsePayload>(
      queryKeys.fieldMappings.impact(id),
      buildUrl(`${FIELD_MAPPINGS_URL}/${encodeURIComponent(id)}/impact`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<
      FieldMappingCreateResponsePayload,
      FieldMappingCreateRequestBody
    >({
      url: FIELD_MAPPINGS_URL,
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<
      FieldMappingUpdateResponsePayload,
      FieldMappingUpdateRequestBody
    >({
      url: `${FIELD_MAPPINGS_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${FIELD_MAPPINGS_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  /** Search field mappings with `include=connectorEntity` — label shows `sourceField (entityLabel)`. */
  searchWithEntity: <TOption extends SelectOption = SelectOption>(
    options?: SearchHookOptions<FieldMappingWithConnectorEntity, TOption>
  ) => {
    const { fetchWithAuth } = useAuthFetch();
    const defaultMap = (fm: FieldMappingWithConnectorEntity): SelectOption => ({
      value: fm.id,
      label: fm.connectorEntity
        ? `${fm.sourceField} (${fm.connectorEntity.label})`
        : fm.sourceField,
    });
    const mapFn = (options?.mapItem ?? defaultMap) as (
      item: FieldMappingWithConnectorEntity
    ) => TOption;

    const config = useMemo(
      () => ({
        url: FIELD_MAPPINGS_URL,
        fetcher: fetchWithAuth,
        getItems: (
          res: ApiSuccessResponse<FieldMappingListWithConnectorEntityResponsePayload>
        ) => res.payload.fieldMappings,
        mapItem: mapFn,
        defaultParams: {
          include: "connectorEntity",
          ...options?.defaultParams,
        },
        loadSelectedOption: async (id: string): Promise<TOption | null> => {
          const res = (await fetchWithAuth(
            `${FIELD_MAPPINGS_URL}/${encodeURIComponent(id)}?include=connectorEntity`
          )) as ApiSuccessResponse<FieldMappingGetResponsePayload>;
          return mapFn(
            res.payload
              .fieldMapping as unknown as FieldMappingWithConnectorEntity
          );
        },
      }),
      [fetchWithAuth, mapFn, options?.defaultParams]
    );

    const { loadSelectedOption, ...rest } = useAsyncFilterOptions<
      ApiSuccessResponse<FieldMappingListWithConnectorEntityResponsePayload>,
      FieldMappingWithConnectorEntity,
      TOption
    >(config);
    return { ...rest, getById: loadSelectedOption };
  },

  /** Search field mappings with `include=columnDefinition` — label shows columnDefinition label or sourceField. */
  searchWithColumnDefinition: <TOption extends SelectOption = SelectOption>(
    options?: SearchHookOptions<FieldMappingWithColumnDefinition, TOption>
  ) => {
    const { fetchWithAuth } = useAuthFetch();
    const defaultMap = (
      fm: FieldMappingWithColumnDefinition
    ): SelectOption => ({
      value: fm.id,
      label: fm.columnDefinition?.label ?? fm.sourceField,
    });
    const mapFn = (options?.mapItem ?? defaultMap) as (
      item: FieldMappingWithColumnDefinition
    ) => TOption;

    const config = useMemo(
      () => ({
        url: FIELD_MAPPINGS_URL,
        fetcher: fetchWithAuth,
        getItems: (
          res: ApiSuccessResponse<FieldMappingListWithColumnDefinitionResponsePayload>
        ) => res.payload.fieldMappings,
        mapItem: mapFn,
        defaultParams: {
          include: "columnDefinition",
          ...options?.defaultParams,
        },
        loadSelectedOption: async (id: string): Promise<TOption | null> => {
          const res = (await fetchWithAuth(
            `${FIELD_MAPPINGS_URL}/${encodeURIComponent(id)}?include=columnDefinition`
          )) as ApiSuccessResponse<FieldMappingGetResponsePayload>;
          return mapFn(
            res.payload
              .fieldMapping as unknown as FieldMappingWithColumnDefinition
          );
        },
      }),
      [fetchWithAuth, mapFn, options?.defaultParams]
    );

    const { loadSelectedOption, ...rest } = useAsyncFilterOptions<
      ApiSuccessResponse<FieldMappingListWithColumnDefinitionResponsePayload>,
      FieldMappingWithColumnDefinition,
      TOption
    >(config);
    return { ...rest, getById: loadSelectedOption };
  },
};

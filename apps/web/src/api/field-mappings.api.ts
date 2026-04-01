import type {
  FieldMappingListRequestQuery,
  FieldMappingListResponsePayload,
  FieldMappingListWithConnectorEntityResponsePayload,
  FieldMappingBidirectionalValidationResponsePayload,
  FieldMappingImpactResponsePayload,
  FieldMappingUpdateRequestBody,
  FieldMappingUpdateResponsePayload,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

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

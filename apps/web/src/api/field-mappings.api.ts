import type {
  FieldMappingListRequestQuery,
  FieldMappingListResponsePayload,
  FieldMappingListWithConnectorEntityResponsePayload,
} from "@portalai/core/contracts";
import { useAuthQuery } from "../utils/api.util";
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
};

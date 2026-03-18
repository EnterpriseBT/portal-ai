import type {
  FieldMappingListRequestQuery,
  FieldMappingListResponsePayload,
} from "@portalai/core/contracts";
import { useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const fieldMappings = {
  list: (
    params?: FieldMappingListRequestQuery,
    options?: QueryOptions<FieldMappingListResponsePayload>
  ) =>
    useAuthQuery<FieldMappingListResponsePayload>(
      queryKeys.fieldMappings.list(params),
      buildUrl("/api/field-mappings", params),
      undefined,
      options
    ),
};

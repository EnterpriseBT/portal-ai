import React from "react";

import { UseQueryResult } from "@tanstack/react-query";
import type {
  FieldMappingListRequestQuery,
  FieldMappingListResponsePayload,
  FieldMappingListWithConnectorEntityResponsePayload,
} from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { ApiError } from "../utils";

// ── Data Component ──────────────────────────────────────────────────

export interface FieldMappingDataListProps<
  T extends
    | FieldMappingListResponsePayload
    | FieldMappingListWithConnectorEntityResponsePayload =
    FieldMappingListResponsePayload,
> {
  query: FieldMappingListRequestQuery;
  children: (data: UseQueryResult<T, ApiError>) => React.ReactNode;
}

export const FieldMappingDataList = <
  T extends
    | FieldMappingListResponsePayload
    | FieldMappingListWithConnectorEntityResponsePayload =
    FieldMappingListResponsePayload,
>(
  props: FieldMappingDataListProps<T>
) => {
  const res = sdk.fieldMappings.list<T>(props.query);
  return props.children(res);
};

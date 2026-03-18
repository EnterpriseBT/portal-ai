import React from "react";

import { UseQueryResult } from "@tanstack/react-query";
import type {
  FieldMappingListRequestQuery,
  FieldMappingListResponsePayload,
} from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import { ApiError } from "../utils";

// ── Data Component ──────────────────────────────────────────────────

export interface FieldMappingDataListProps {
  query: FieldMappingListRequestQuery;
  children: (
    data: UseQueryResult<FieldMappingListResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const FieldMappingDataList = (props: FieldMappingDataListProps) => {
  const res = sdk.fieldMappings.list(props.query);
  return props.children(res);
};

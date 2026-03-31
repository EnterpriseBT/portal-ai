import React from "react";

import { UseQueryResult } from "@tanstack/react-query";
import type {
  ColumnDefinitionGetResponsePayload,
  ColumnDefinitionListRequestQuery,
  ColumnDefinitionListResponsePayload,
} from "@portalai/core/contracts";
import type { ColumnDefinition } from "@portalai/core/models";
import {
  DetailCard,
  MetadataList,
  Stack,
} from "@portalai/core/ui";
import Chip from "@mui/material/Chip";

import { sdk } from "../api/sdk";
import { ApiError } from "../utils";

// ── Data Components ─────────────────────────────────────────────────

export interface ColumnDefinitionDataListProps {
  query: ColumnDefinitionListRequestQuery;
  children: (
    data: UseQueryResult<ColumnDefinitionListResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const ColumnDefinitionDataList = (
  props: ColumnDefinitionDataListProps
) => {
  const res = sdk.columnDefinitions.list(props.query);
  return props.children(res);
};

export interface ColumnDefinitionDataItemProps {
  id: string;
  children: (
    data: UseQueryResult<ColumnDefinitionGetResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const ColumnDefinitionDataItem = (
  props: ColumnDefinitionDataItemProps
) => {
  const res = sdk.columnDefinitions.get(props.id);
  return props.children(res);
};

// ── Card UI ─────────────────────────────────────────────────────────

const TYPE_COLOR: Record<string, "primary" | "secondary" | "success" | "warning" | "error" | "info" | "default"> = {
  string: "primary",
  number: "info",
  boolean: "success",
  date: "warning",
  datetime: "warning",
  enum: "secondary",
  json: "default",
  array: "default",
  reference: "error",
  "reference-array": "error",
  currency: "info",
};

export interface ColumnDefinitionCardUIProps {
  columnDefinition: ColumnDefinition;
  onClick?: (columnDefinition: ColumnDefinition) => void;
}

export const ColumnDefinitionCardUI: React.FC<ColumnDefinitionCardUIProps> = ({
  columnDefinition: cd,
  onClick,
}) => {
  return (
    <DetailCard
      title={cd.label}
      onClick={onClick ? () => onClick(cd) : undefined}
    >
      <MetadataList
        items={[
          {
            label: "Type",
            value: (
              <Stack direction="row" spacing={1}>
                <Chip
                  label={cd.type}
                  size="small"
                  color={TYPE_COLOR[cd.type] ?? "default"}
                  variant="outlined"
                />
                {cd.required && (
                  <Chip label="Required" size="small" color="error" />
                )}
              </Stack>
            ),
            variant: "chip",
          },
          { label: "Key", value: cd.key, variant: "mono" },
          { label: "Description", value: cd.description ?? "", hidden: !cd.description },
          { label: "Format", value: cd.format ?? "", hidden: !cd.format },
          { label: "Default", value: cd.defaultValue ?? "", hidden: !cd.defaultValue },
          { label: "Values", value: cd.enumValues?.join(", ") ?? "", hidden: !cd.enumValues || cd.enumValues.length === 0 },
        ]}
      />
    </DetailCard>
  );
};

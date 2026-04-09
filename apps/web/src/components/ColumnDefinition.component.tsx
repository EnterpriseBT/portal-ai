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
} from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import DeleteIcon from "@mui/icons-material/Delete";

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
};

export interface ColumnDefinitionCardUIProps {
  columnDefinition: ColumnDefinition;
  onClick?: (columnDefinition: ColumnDefinition) => void;
  onDelete?: (columnDefinition: ColumnDefinition) => void;
}

export const ColumnDefinitionCardUI: React.FC<ColumnDefinitionCardUIProps> = ({
  columnDefinition: cd,
  onClick,
  onDelete,
}) => {
  const actions: ActionSuiteItem[] = onDelete
    ? [{ label: "Delete", icon: <DeleteIcon />, onClick: () => onDelete(cd), color: "error" }]
    : [];

  return (
    <DetailCard
      title={cd.label}
      onClick={onClick ? () => onClick(cd) : undefined}
      actions={actions}
    >
      <MetadataList
        items={[
          {
            label: "Type",
            value: (
              <Chip
                label={cd.type}
                size="small"
                color={TYPE_COLOR[cd.type] ?? "default"}
                variant="outlined"
              />
            ),
            variant: "chip",
          },
          { label: "Key", value: cd.key, variant: "mono" },
          { label: "Description", value: cd.description ?? "", hidden: !cd.description },
        ]}
      />
    </DetailCard>
  );
};

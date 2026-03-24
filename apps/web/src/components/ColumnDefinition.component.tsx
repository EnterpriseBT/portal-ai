import React from "react";

import { UseQueryResult } from "@tanstack/react-query";
import type {
  ColumnDefinitionGetResponsePayload,
  ColumnDefinitionListRequestQuery,
  ColumnDefinitionListResponsePayload,
} from "@portalai/core/contracts";
import type { ColumnDefinition } from "@portalai/core/models";
import {
  Card,
  CardContent,
  Stack,
  Typography,
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
    <Card
      variant="outlined"
      sx={{ cursor: onClick ? "pointer" : undefined }}
      onClick={() => onClick?.(cd)}
    >
      <CardContent>
        <Stack spacing={0.5}>
          {/* Header row: Label, Type chip, Required badge */}
          <Stack direction="row" spacing={1} alignItems="center" flexWrap="wrap">
            <Typography variant="subtitle1" noWrap sx={{ flex: 1, minWidth: 0 }}>
              {cd.label}
            </Typography>
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

          {/* Detail row: Key (monospace), description */}
          <Stack direction="row" spacing={2} alignItems="baseline">
            <Typography variant="body2" sx={{ fontFamily: "monospace" }} color="text.secondary">
              {cd.key}
            </Typography>
            {cd.description && (
              <Typography variant="body2" color="text.secondary" noWrap>
                {cd.description}
              </Typography>
            )}
          </Stack>

          {/* Metadata row: Format, default value, enum values */}
          {(cd.format || cd.defaultValue || cd.enumValues) && (
            <Stack direction="row" spacing={2} flexWrap="wrap">
              {cd.format && (
                <Typography variant="caption" color="text.secondary">
                  Format: {cd.format}
                </Typography>
              )}
              {cd.defaultValue && (
                <Typography variant="caption" color="text.secondary">
                  Default: {cd.defaultValue}
                </Typography>
              )}
              {cd.enumValues && cd.enumValues.length > 0 && (
                <Typography variant="caption" color="text.secondary">
                  Values: {cd.enumValues.join(", ")}
                </Typography>
              )}
            </Stack>
          )}
        </Stack>
      </CardContent>
    </Card>
  );
};

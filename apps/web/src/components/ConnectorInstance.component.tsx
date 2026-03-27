import React from "react";

import { UseQueryResult } from "@tanstack/react-query";
import type {
  ConnectorInstanceApi,
  ConnectorInstanceListRequestQuery,
  ConnectorInstanceListResponsePayload,
  ConnectorInstanceListWithDefinitionResponsePayload,
  ConnectorInstanceGetResponsePayload,
} from "@portalai/core/contracts";
import type { ConnectorDefinition } from "@portalai/core/models";
import {
  Avatar,
  Box,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@portalai/core/ui";
import CardActionArea from "@mui/material/CardActionArea";
import Chip from "@mui/material/Chip";
import IconButton from "@mui/material/IconButton";
import Tooltip from "@mui/material/Tooltip";
import DeleteOutlineIcon from "@mui/icons-material/DeleteOutline";
import { upperFirst } from "lodash-es";

import { sdk } from "../api/sdk";
import { ApiError } from "../utils";

export interface ConnectorInstanceDataListProps {
  query: ConnectorInstanceListRequestQuery;
  children: (
    data: UseQueryResult<ConnectorInstanceListResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const ConnectorInstanceDataList = (
  props: ConnectorInstanceDataListProps
) => {
  const res = sdk.connectorInstances.list(props.query);
  return props.children(res);
};

export interface ConnectorInstanceWithDefinitionDataListProps {
  query: ConnectorInstanceListRequestQuery;
  children: (
    data: UseQueryResult<ConnectorInstanceListWithDefinitionResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const ConnectorInstanceWithDefinitionDataList = (
  props: ConnectorInstanceWithDefinitionDataListProps
) => {
  const res = sdk.connectorInstances.listWithDefinition(props.query);
  return props.children(res);
};

export interface ConnectorInstanceDataItemProps {
  id: string;
  children: (
    data: UseQueryResult<ConnectorInstanceGetResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const ConnectorInstanceDataItem = (
  props: ConnectorInstanceDataItemProps
) => {
  const res = sdk.connectorInstances.get(props.id);
  return props.children(res);
};

const STATUS_COLOR: Record<
  string,
  "success" | "error" | "warning" | "default"
> = {
  active: "success",
  error: "error",
  pending: "warning",
  inactive: "default",
};

export interface ConnectorInstanceCardUIProps {
  connectorInstance: ConnectorInstanceApi;
  connectorDefinition?: ConnectorDefinition;
  onClick?: (connectorInstance: ConnectorInstanceApi) => void;
  onDelete?: (connectorInstance: ConnectorInstanceApi) => void;
}

export const ConnectorInstanceCardUI = ({
  connectorInstance: ci,
  connectorDefinition: cd,
  onClick,
  onDelete,
}: ConnectorInstanceCardUIProps) => {
  return (
    <Card variant="outlined">
      <Stack
        direction={{ xs: "column", sm: "row" }}
        alignItems={{ xs: "flex-start", sm: "center" }}
      >
        <CardActionArea
          onClick={() => onClick?.(ci)}
          disabled={!onClick}
          sx={{ flex: 1, minWidth: 0 }}
        >
          <CardContent sx={{ "&:last-child": { pb: 2 } }}>
            <Stack
              direction={{ xs: "column", sm: "row" }}
              spacing={2}
              alignItems={{ xs: "center", sm: "center" }}
            >
              <Avatar
                src={cd?.iconUrl ?? undefined}
                alt={ci.name}
                sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: "white", p: 0.5 }}
              >
                {ci.name.charAt(0).toUpperCase()}
              </Avatar>

              <Box
                sx={{
                  flex: 1,
                  minWidth: 0,
                  textAlign: { xs: "center", sm: "left" },
                }}
              >
                <Stack
                  direction="row"
                  spacing={1}
                  alignItems="center"
                  justifyContent={{ xs: "center", sm: "flex-start" }}
                  flexWrap="wrap"
                >
                  <Typography variant="subtitle1" noWrap>
                    {ci.name}
                  </Typography>
                  <Chip
                    label={upperFirst(ci.status)}
                    size="small"
                    color={STATUS_COLOR[ci.status] ?? "default"}
                    variant="outlined"
                  />
                </Stack>

                <Typography variant="body2" color="text.secondary">
                  {cd?.display ?? "Unknown connector"}
                  {ci.lastSyncAt &&
                    ` · Last sync: ${new Date(ci.lastSyncAt).toLocaleDateString()}`}
                </Typography>

                {ci.status === "error" && ci.lastErrorMessage && (
                  <Typography variant="body2" color="error" noWrap>
                    {ci.lastErrorMessage}
                  </Typography>
                )}
              </Box>
            </Stack>
          </CardContent>
        </CardActionArea>

        {onDelete && (
          <Box sx={{ flexShrink: 0, pr: 2, py: 1 }}>
            <Tooltip title="Delete">
              <IconButton
                size="small"
                color="error"
                onClick={() => onDelete(ci)}
              >
                <DeleteOutlineIcon fontSize="small" />
              </IconButton>
            </Tooltip>
          </Box>
        )}
      </Stack>
    </Card>
  );
};

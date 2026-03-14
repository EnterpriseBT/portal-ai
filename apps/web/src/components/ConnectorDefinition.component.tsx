import {
  ConnectorDefinitionGetResponsePayload,
  ConnectorDefinitionListRequestQuery,
  ConnectorDefinitionListResponsePayload,
} from "@portalai/core/contracts";
import React from "react";
import { sdk } from "../api/sdk";
import { UseQueryResult } from "@tanstack/react-query";
import { ConnectorDefinition } from "@portalai/core/models";
import { ApiError } from "../utils";
import {
  Avatar,
  Box,
  Card,
  CardContent,
  Stack,
  Typography,
} from "@portalai/core/ui";
import Chip from "@mui/material/Chip";

export interface ConnectorDefinitionDataListProps {
  query: ConnectorDefinitionListRequestQuery;
  children: (
    data: UseQueryResult<ConnectorDefinitionListResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const ConnectorDefinitionDataList = (
  props: ConnectorDefinitionDataListProps
) => {
  const res = sdk.connectorDefinitions.list(props.query);
  return props.children(res);
};

export interface ConnectorDefinitionDataItemProps {
  id: string;
  children: (
    data: UseQueryResult<ConnectorDefinitionGetResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const ConnectorDefinitionDataItem = (
  props: ConnectorDefinitionDataItemProps
) => {
  const res = sdk.connectorDefinitions.get(props.id);
  return props.children(res);
};

export interface ConnectorDefinitionItemProps {
  connectorDefinition: ConnectorDefinition;
  children: (data: ConnectorDefinition) => React.ReactNode;
}

export const ConnectorDefinitionItem = (
  props: ConnectorDefinitionItemProps
) => {
  return props.children(props.connectorDefinition);
};

export interface ConnectorDefinitionCardProps {
  connectorDefinition: ConnectorDefinition;
}

export const ConnectorDefinitionCard = ({
  connectorDefinition: cd,
}: ConnectorDefinitionCardProps) => {
  const capabilities = (["sync", "query", "write"] as const).filter(
    (c) => cd.capabilityFlags[c]
  );

  return (
    <Card variant="outlined">
      <CardContent>
        <Stack direction="row" spacing={2} alignItems="center">
          <Avatar
            src={cd.iconUrl ?? undefined}
            alt={cd.display}
            sx={{ width: 40, height: 40, borderRadius: 1 }}
          >
            {cd.display.charAt(0).toUpperCase()}
          </Avatar>

          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Stack
              direction="row"
              spacing={1}
              alignItems="center"
              flexWrap="wrap"
            >
              <Typography variant="subtitle1" noWrap>
                {cd.display}
              </Typography>
              <Chip
                label={cd.isActive ? "Active" : "Inactive"}
                size="small"
                color={cd.isActive ? "success" : "default"}
                variant="outlined"
              />
            </Stack>

            <Typography variant="body2" color="text.secondary">
              {cd.category} &middot; {cd.authType} &middot; v{cd.version}
            </Typography>

            {capabilities.length > 0 && (
              <Stack direction="row" spacing={0.5} sx={{ mt: 0.5 }}>
                {capabilities.map((cap) => (
                  <Chip key={cap} label={cap} size="small" variant="outlined" />
                ))}
              </Stack>
            )}
          </Box>
        </Stack>
      </CardContent>
    </Card>
  );
};

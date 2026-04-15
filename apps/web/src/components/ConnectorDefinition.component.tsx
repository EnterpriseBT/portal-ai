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
  DetailCard,
  MetadataList,
  Stack,
} from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import LinkIcon from "@mui/icons-material/Link";

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

export interface ConnectorDefinitionCardUIProps {
  connectorDefinition: ConnectorDefinition;
  onConnect?: (connectorDefinition: ConnectorDefinition) => void;
}

export const ConnectorDefinitionCardUI = ({
  connectorDefinition: cd,
  onConnect,
}: ConnectorDefinitionCardUIProps) => {
  const capabilities = (["sync", "read", "write", "push"] as const).filter(
    (c) => cd.capabilityFlags[c]
  );

  const actions: ActionSuiteItem[] = [
    { label: "Connect", icon: <LinkIcon />, onClick: () => onConnect?.(cd), variant: "contained" },
  ];

  return (
    <DetailCard
      title={cd.display}
      icon={
        <Avatar
          src={cd.iconUrl ?? undefined}
          alt={cd.display}
          sx={{ width: 40, height: 40, borderRadius: 1, bgcolor: "white", p: 0.5 }}
        >
          {cd.display.charAt(0).toUpperCase()}
        </Avatar>
      }
      actions={actions}
    >
      <MetadataList
        items={[
          {
            label: "Status",
            value: (
              <Chip
                label={cd.isActive ? "Active" : "Inactive"}
                size="small"
                color={cd.isActive ? "success" : "default"}
                variant="outlined"
              />
            ),
            variant: "chip",
          },
          { label: "Category", value: cd.category },
          { label: "Auth", value: cd.authType },
          { label: "Version", value: `v${cd.version}` },
          {
            label: "Capabilities",
            value: (
              <Stack direction="row" spacing={0.5}>
                {capabilities.map((cap) => (
                  <Chip key={cap} label={cap} size="small" variant="outlined" />
                ))}
              </Stack>
            ),
            variant: "chip",
            hidden: capabilities.length === 0,
          },
        ]}
      />
    </DetailCard>
  );
};

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
import { Avatar, DetailCard, MetadataList } from "@portalai/core/ui";
import type { ActionSuiteItem } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import DeleteIcon from "@mui/icons-material/Delete";
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
    data: UseQueryResult<
      ConnectorInstanceListWithDefinitionResponsePayload,
      ApiError
    >
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
  const actions: ActionSuiteItem[] = [];
  if (onDelete) {
    actions.push({
      label: "Delete",
      icon: <DeleteIcon />,
      onClick: () => onDelete(ci),
      color: "error",
    });
  }

  return (
    <DetailCard
      title={ci.name}
      icon={
        <Avatar
          src={cd?.iconUrl ?? undefined}
          alt={ci.name}
          sx={{
            width: 40,
            height: 40,
            borderRadius: 1,
            bgcolor: "white",
            p: 0.5,
          }}
        >
          {ci.name.charAt(0).toUpperCase()}
        </Avatar>
      }
      onClick={onClick ? () => onClick(ci) : undefined}
      actions={actions.length > 0 ? actions : undefined}
    >
      <MetadataList
        items={[
          {
            label: "Status",
            value: (
              <Chip
                label={upperFirst(ci.status)}
                size="small"
                color={STATUS_COLOR[ci.status] ?? "default"}
                variant="outlined"
              />
            ),
            variant: "chip",
          },
          { label: "Connector", value: cd?.display ?? "Unknown connector" },
          {
            label: "Last sync",
            value: ci.lastSyncAt
              ? new Date(ci.lastSyncAt).toLocaleDateString()
              : "",
            hidden: !ci.lastSyncAt,
          },
          {
            label: "Error",
            value: ci.lastErrorMessage ?? "",
            hidden: !(ci.status === "error" && ci.lastErrorMessage),
          },
        ]}
      />
    </DetailCard>
  );
};

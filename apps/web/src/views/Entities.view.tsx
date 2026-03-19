import React from "react";

import type {
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithInstanceResponsePayload,
} from "@portalai/core/contracts";
import { Box, Breadcrumbs, Stack, Typography } from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Card from "@mui/material/Card";
import CardActionArea from "@mui/material/CardActionArea";
import CardContent from "@mui/material/CardContent";

import { useNavigate } from "@tanstack/react-router";

import { ConnectorEntityDataList } from "../components/ConnectorEntity.component";
import DataResult from "../components/DataResult.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk } from "../api/sdk";

// ── Connector instance filter options hook ───────────────────────────

function useConnectorInstanceOptions() {
  const res = sdk.connectorInstances.list({
    limit: 100,
    offset: 0,
    sortBy: "created",
    sortOrder: "asc",
  });
  if (!res.data) return [];
  return res.data.connectorInstances.map((ci) => ({
    label: ci.name,
    value: ci.id,
  }));
}

// ── Entity card ─────────────────────────────────────────────────────

interface EntityCardProps {
  entity: ConnectorEntityListWithInstanceResponsePayload["connectorEntities"][number];
  onClick: () => void;
}

const EntityCard: React.FC<EntityCardProps> = ({ entity, onClick }) => (
  <Card variant="outlined">
    <CardActionArea onClick={onClick}>
      <CardContent>
        <Stack direction="row" alignItems="center" spacing={1}>
          <Box sx={{ flex: 1, minWidth: 0 }}>
            <Typography variant="subtitle1" noWrap>
              {entity.label}
            </Typography>
            <Typography variant="caption" color="text.secondary">
              {entity.connectorInstance.name}
            </Typography>
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5 }}>
              <Chip label={entity.key} size="small" variant="outlined" />
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </CardActionArea>
  </Card>
);

// ── Entities list view (pure UI) ────────────────────────────────────

export interface EntitiesViewUIProps {
  connectorInstanceOptions: { label: string; value: string }[];
}

export const EntitiesViewUI: React.FC<EntitiesViewUIProps> = ({
  connectorInstanceOptions,
}) => {
  const navigate = useNavigate();

  const pagination = usePagination({
    sortFields: [
      { field: "key", label: "Key" },
      { field: "label", label: "Label" },
      { field: "created", label: "Created" },
    ],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
    filters: [
      {
        type: "select",
        field: "connectorInstanceId",
        label: "Connector Instance",
        options: connectorInstanceOptions,
      },
    ],
  });

  return (
    <Box>
      <Stack spacing={4}>
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/", icon: IconName.Home },
            { label: "Entities" },
          ]}
          onNavigate={(href) => navigate({ to: href })}
        />

        <Typography variant="h1">Entities</Typography>

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <ConnectorEntityDataList
            query={
              {
                ...pagination.queryParams,
                include: "connectorInstance",
              } as ConnectorEntityListRequestQuery
            }
          >
            {(listResult) => (
              <SyncTotal
                total={listResult.data?.total}
                setTotal={pagination.setTotal}
              >
                <DataResult results={{ list: listResult }}>
                  {(data) => {
                    const list = data.list as unknown as ConnectorEntityListWithInstanceResponsePayload;
                    if (list.connectorEntities.length === 0) {
                      return (
                        <Typography
                          variant="body1"
                          color="text.secondary"
                          sx={{ py: 4, textAlign: "center" }}
                        >
                          No entities found
                        </Typography>
                      );
                    }

                    return (
                      <Stack spacing={1}>
                        {list.connectorEntities.map((entity) => (
                          <EntityCard
                            key={entity.id}
                            entity={entity}
                            onClick={() =>
                              navigate({
                                to: `/entities/${entity.id}`,
                              })
                            }
                          />
                        ))}
                      </Stack>
                    );
                  }}
                </DataResult>
              </SyncTotal>
            )}
          </ConnectorEntityDataList>
        </Box>
      </Stack>
    </Box>
  );
};

// ── Container (wires hooks) ─────────────────────────────────────────

export const EntitiesView: React.FC = () => {
  const connectorInstanceOptions = useConnectorInstanceOptions();
  return <EntitiesViewUI connectorInstanceOptions={connectorInstanceOptions} />;
};

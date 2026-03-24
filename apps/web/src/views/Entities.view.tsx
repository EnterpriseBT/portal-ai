import React from "react";

import type {
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithInstanceResponsePayload,
} from "@portalai/core/contracts";
import type { EntityTag } from "@portalai/core/models";
import { Box, Breadcrumbs, Stack, Typography } from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";
import type { FetchPageParams, FetchPageResult } from "@portalai/core/ui";
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
import { useEntityTagFilter } from "../api/entity-tags.api";
import { useConnectorInstanceFilter } from "../api/connector-instances.api";

// ── Entity card ─────────────────────────────────────────────────────

type EntityWithTags = ConnectorEntityListWithInstanceResponsePayload["connectorEntities"][number] & {
  tags?: EntityTag[];
};

interface EntityCardProps {
  entity: EntityWithTags;
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
            <Stack direction="row" spacing={1} alignItems="center" sx={{ mt: 0.5, flexWrap: "wrap" }}>
              <Chip label={entity.key} size="small" variant="outlined" />
              {entity.tags?.map((tag) => (
                <Chip
                  key={tag.id}
                  label={tag.name}
                  size="small"
                  icon={
                    tag.color ? (
                      <Box
                        sx={{
                          width: 12,
                          height: 12,
                          borderRadius: "50%",
                          backgroundColor: tag.color,
                          flexShrink: 0,
                        }}
                      />
                    ) : undefined
                  }
                />
              ))}
            </Stack>
          </Box>
        </Stack>
      </CardContent>
    </CardActionArea>
  </Card>
);

// ── Entities list view (pure UI) ────────────────────────────────────

export interface EntitiesViewUIProps {
  connectorInstanceFetchPage: (params: FetchPageParams) => Promise<FetchPageResult>;
  connectorInstanceLabelMap: Record<string, string>;
  tagFetchPage: (params: FetchPageParams) => Promise<FetchPageResult>;
  tagLabelMap: Record<string, string>;
}

export const EntitiesViewUI: React.FC<EntitiesViewUIProps> = ({
  connectorInstanceFetchPage,
  connectorInstanceLabelMap,
  tagFetchPage,
  tagLabelMap,
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
        type: "multi-select",
        field: "connectorInstanceIds",
        label: "Connector Instance",
        fetchPage: connectorInstanceFetchPage,
        labelMap: connectorInstanceLabelMap,
      },
      {
        type: "multi-select",
        field: "tagIds",
        label: "Tags",
        fetchPage: tagFetchPage,
        labelMap: tagLabelMap,
      },
    ],
  });

  return (
    <Box>
      <Stack spacing={4}>
        <Box>
          <Breadcrumbs
            items={[
              { label: "Dashboard", href: "/", icon: IconName.Home },
              { label: "Entities" },
            ]}
            onNavigate={(href) => navigate({ to: href })}
          />

          <Typography variant="h1">Entities</Typography>
        </Box>

        <PaginationToolbar {...pagination.toolbarProps} />

        <Box>
          <ConnectorEntityDataList
            query={
              {
                ...pagination.queryParams,
                include: "connectorInstance,tags",
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
                    const list =
                      data.list as unknown as ConnectorEntityListWithInstanceResponsePayload;
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
  const { fetchPage: connectorInstanceFetchPage, labelMap: connectorInstanceLabelMap } =
    useConnectorInstanceFilter();
  const { fetchPage: tagFetchPage, labelMap: tagLabelMap } =
    useEntityTagFilter();
  return (
    <EntitiesViewUI
      connectorInstanceFetchPage={connectorInstanceFetchPage}
      connectorInstanceLabelMap={connectorInstanceLabelMap}
      tagFetchPage={tagFetchPage}
      tagLabelMap={tagLabelMap}
    />
  );
};

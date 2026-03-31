import React from "react";

import type {
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithInstanceResponsePayload,
} from "@portalai/core/contracts";
import type { EntityTag } from "@portalai/core/models";
import { Box, DetailCard, Icon, IconName, MetadataList, PageEmptyState, PageHeader, Stack } from "@portalai/core/ui";
import type { FetchPageParams, FetchPageResult } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";

import { useNavigate } from "@tanstack/react-router";

import { ConnectorEntityDataList } from "../components/ConnectorEntity.component";
import { EmptyResults } from "../components/EmptyResults.component";
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
  <DetailCard title={entity.label} onClick={onClick}>
    <MetadataList
      items={[
        { label: "Connector", value: entity.connectorInstance.name },
        { label: "Key", value: entity.key, variant: "mono" },
        {
          label: "Tags",
          value: (
            <Stack direction="row" spacing={1} sx={{ flexWrap: "wrap" }}>
              {(entity.tags ?? []).map((tag) => (
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
          ),
          variant: "chip",
          hidden: !entity.tags || entity.tags.length === 0,
        },
      ]}
    />
  </DetailCard>
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
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Entities" },
          ]}
          onNavigate={(href) => navigate({ to: href })}
          title="Entities"
          icon={<Icon name={IconName.DataObject} />}
        />

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
                      const hasActiveFilters = pagination.search || Object.values(pagination.filters).some(v => v.length > 0);
                      return hasActiveFilters ? (
                        <EmptyResults />
                      ) : (
                        <PageEmptyState
                          icon={<Icon name={IconName.DataObject} />}
                          title="No entities found"
                        />
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

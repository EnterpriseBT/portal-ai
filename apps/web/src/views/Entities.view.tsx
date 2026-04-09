import React, { useState, useCallback } from "react";

import type {
  ConnectorEntityListRequestQuery,
  ConnectorEntityListWithInstanceResponsePayload,
} from "@portalai/core/contracts";
import type { EntityTag } from "@portalai/core/models";
import type { ConnectorEntityCreateRequestBody } from "@portalai/core/contracts";
import { Box, Button, DetailCard, Icon, IconName, MetadataList, PageEmptyState, PageHeader, Stack } from "@portalai/core/ui";
import type { ActionSuiteItem, FetchPageParams, FetchPageResult } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import DeleteIcon from "@mui/icons-material/Delete";
import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import AddIcon from "@mui/icons-material/Add";
import { ConnectorEntityDataList } from "../components/ConnectorEntity.component";
import { CreateConnectorEntityDialog } from "../components/CreateConnectorEntityDialog.component";
import { DeleteConnectorEntityDialog } from "../components/DeleteConnectorEntityDialog.component";
import { EmptyResults } from "../components/EmptyResults.component";
import DataResult from "../components/DataResult.component";
import { SyncTotal } from "../components/SyncTotal.component";
import {
  usePagination,
  PaginationToolbar,
} from "../components/PaginationToolbar.component";
import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";

// ── Entity card ─────────────────────────────────────────────────────

type EntityWithTags = ConnectorEntityListWithInstanceResponsePayload["connectorEntities"][number] & {
  tags?: EntityTag[];
};

interface EntityCardProps {
  entity: EntityWithTags;
  onClick: () => void;
  onDelete: () => void;
}

const EntityCard: React.FC<EntityCardProps> = ({ entity, onClick, onDelete }) => {
  const actions: ActionSuiteItem[] = [
    { label: "Delete", icon: <DeleteIcon />, onClick: onDelete, color: "error" as const },
  ];

  return (
    <DetailCard title={entity.label} onClick={onClick} actions={actions}>
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
};

// ── Entities list view (pure UI) ────────────────────────────────────

export interface EntitiesViewUIProps {
  connectorInstanceFetchPage: (params: FetchPageParams) => Promise<FetchPageResult>;
  connectorInstanceLabelMap: Record<string, string>;
  tagFetchPage: (params: FetchPageParams) => Promise<FetchPageResult>;
  tagLabelMap: Record<string, string>;
  onDeleteEntity: (entity: EntityWithTags) => void;
  onCreate: () => void;
}

export const EntitiesViewUI: React.FC<EntitiesViewUIProps> = ({
  connectorInstanceFetchPage,
  connectorInstanceLabelMap,
  tagFetchPage,
  tagLabelMap,
  onDeleteEntity,
  onCreate,
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
          primaryAction={
            <Button variant="contained" startIcon={<AddIcon />} onClick={onCreate}>
              Create Entity
            </Button>
          }
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
                            onDelete={() => onDeleteEntity(entity)}
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
  const queryClient = useQueryClient();
  const { fetchPage: connectorInstanceFetchPage, labelMap: connectorInstanceLabelMap } =
    sdk.connectorInstances.filter();
  const { fetchPage: tagFetchPage, labelMap: tagLabelMap } =
    sdk.entityTags.filter();

  const [createOpen, setCreateOpen] = useState(false);
  const createMutation = sdk.connectorEntities.create();
  const [deletingEntity, setDeletingEntity] = useState<EntityWithTags | null>(null);

  const deleteMutation = sdk.connectorEntities.delete(deletingEntity?.id ?? "");
  const impactQuery = sdk.connectorEntities.impact(deletingEntity?.id ?? "", {
    enabled: !!deletingEntity,
  });

  const handleCreateClose = useCallback(() => {
    setCreateOpen(false);
    createMutation.reset();
  }, [createMutation]);

  const handleCreateSubmit = useCallback(
    (body: ConnectorEntityCreateRequestBody) => {
      createMutation.mutate(body, {
        onSuccess: () => {
          handleCreateClose();
          queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root });
        },
      });
    },
    [createMutation, handleCreateClose, queryClient]
  );

  const handleDeleteEntity = useCallback((entity: EntityWithTags) => {
    setDeletingEntity(entity);
  }, []);

  const handleDeleteClose = useCallback(() => {
    setDeletingEntity(null);
  }, []);

  const handleDeleteConfirm = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setDeletingEntity(null);
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.entityRecords.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.entityGroups.root });
      },
    });
  }, [deleteMutation, queryClient]);

  return (
    <>
      <EntitiesViewUI
        connectorInstanceFetchPage={connectorInstanceFetchPage}
        connectorInstanceLabelMap={connectorInstanceLabelMap}
        tagFetchPage={tagFetchPage}
        tagLabelMap={tagLabelMap}
        onDeleteEntity={handleDeleteEntity}
        onCreate={() => setCreateOpen(true)}
      />

      <CreateConnectorEntityDialog
        open={createOpen}
        onClose={handleCreateClose}
        onSubmit={handleCreateSubmit}
        isPending={createMutation.isPending}
        serverError={toServerError(createMutation.error)}
        lockedConnectorInstance={null}
      />

      <DeleteConnectorEntityDialog
        open={!!deletingEntity}
        onClose={handleDeleteClose}
        connectorEntityLabel={deletingEntity?.label ?? ""}
        onConfirm={handleDeleteConfirm}
        isPending={deleteMutation.isPending}
        impact={impactQuery.data ?? null}
        isLoadingImpact={impactQuery.isLoading && !!deletingEntity}
        serverError={toServerError(deleteMutation.error)}
      />
    </>
  );
};

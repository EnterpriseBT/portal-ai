import React, { useCallback, useState } from "react";

import type {
  ConnectorEntityGetResponsePayload,
  ConnectorEntityPatchRequestBody,
  ResolvedColumn,
  EntityRecordListRequestQuery,
  EntityRecordListResponsePayload,
  EntityRecordCountResponsePayload,
  FieldMappingListResponsePayload,
  AssignedEntityTag,
} from "@portalai/core/contracts";
import { Box, Icon, IconName, MetadataList, PageHeader, PageSection, Stack } from "@portalai/core/ui";
import { AsyncSearchableSelect } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import AddIcon from "@mui/icons-material/Add";
import DeleteIcon from "@mui/icons-material/Delete";
import EditIcon from "@mui/icons-material/Edit";
import RefreshIcon from "@mui/icons-material/Refresh";

import { useQueryClient } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";

import { sdk, queryKeys } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import type { ServerError } from "../utils/api.util";
import DataResult from "../components/DataResult.component";
import { DeleteConnectorEntityDialog } from "../components/DeleteConnectorEntityDialog.component";
import { EditConnectorEntityDialog } from "../components/EditConnectorEntityDialog.component";
import { CreateEntityRecordDialog } from "../components/CreateEntityRecordDialog.component";
import type { EntityRecordCreateRequestBody } from "@portalai/core/contracts";
import { BidirectionalConsistencyBanner } from "../components/BidirectionalConsistencyBanner.component";
import { SyncTotal } from "../components/SyncTotal.component";
import { SyncColumns } from "../components/SyncColumns.component";
import {
  usePagination,
  PaginationToolbar,
  type PaginationPersistedState,
} from "../components/PaginationToolbar.component";
import { useStorage } from "../utils/storage.util";
import {
  stripInvalidColumns,
  isFilterExpressionEmpty,
} from "../utils/advanced-filter-builder.util";
import {
  EntityRecordDataTable,
  EntityRecordDataTableUI,
} from "../components/EntityRecordDataTable.component";

// ── Tag assignment select ────────────────────────────────────────────

interface TagAssignSelectProps {
  onSearch: (query: string) => Promise<SelectOption[]>;
  onAssign: (entityTagId: string) => void;
}

const TagAssignSelect: React.FC<TagAssignSelectProps> = ({
  onSearch,
  onAssign,
}) => {
  const [value, setValue] = React.useState<string | null>(null);

  const handleChange = (newValue: string | null) => {
    if (newValue) {
      onAssign(newValue);
      setValue(null);
    } else {
      setValue(null);
    }
  };

  return (
    <AsyncSearchableSelect
      value={value}
      onChange={handleChange}
      onSearch={onSearch}
      label="Add tag"
      placeholder="Search tags…"
      size="small"
    />
  );
};

// ── Pure UI ─────────────────────────────────────────────────────────

export interface BidirectionalFieldMappingRef {
  id: string;
  sourceField: string;
}

export interface EntityDetailViewUIProps {
  entity: ConnectorEntityGetResponsePayload["connectorEntity"];
  connectorInstanceName?: string;
  recordCount?: number;
  lastSyncAt?: number | null;
  accessMode?: string;
  onSync?: () => void;
  isSyncing?: boolean;
  /** Field mappings of type reference-array that have a back-reference configured. */
  bidirectionalFieldMappings?: BidirectionalFieldMappingRef[];
  /** Called when a record row is clicked. Overrides the default navigation behaviour — useful for testing. */
  onRecordClick?: (recordId: string) => void;
  /** Tags currently assigned to this entity. */
  tags?: AssignedEntityTag[];
  /** Called when a tag is selected for assignment. */
  onAssignTag?: (entityTagId: string) => void;
  /** Called when a tag chip's delete icon is clicked. */
  onUnassignTag?: (assignmentId: string) => void;
  /** Search callback for the tag assignment autocomplete. */
  onSearchTags?: (query: string) => Promise<SelectOption[]>;
  /** Whether the connector instance has write capability. */
  isWriteEnabled?: boolean;
  /** Called when user confirms entity deletion. */
  onDelete?: () => void;
  /** Whether the delete mutation is in progress. */
  isDeleting?: boolean;
  /** Server error from the delete mutation. */
  deleteServerError?: ServerError | null;
  /** Impact data for deletion. */
  deleteImpact?: { entityRecords: number; fieldMappings: number; entityTagAssignments: number; entityGroupMembers: number; refFieldMappings: number } | null;
  /** Whether impact is loading. */
  isLoadingDeleteImpact?: boolean;
  /** Whether the delete dialog is open. */
  deleteDialogOpen?: boolean;
  /** Open/close the delete dialog. */
  onOpenDeleteDialog?: () => void;
  onCloseDeleteDialog?: () => void;
  /** Called when user submits entity edit. */
  onUpdate?: (body: ConnectorEntityPatchRequestBody) => void;
  isUpdating?: boolean;
  updateServerError?: ServerError | null;
  editDialogOpen?: boolean;
  onOpenEditDialog?: () => void;
  onCloseEditDialog?: () => void;
  /** Create record dialog state */
  createRecordDialogOpen?: boolean;
  onOpenCreateRecordDialog?: () => void;
  onCloseCreateRecordDialog?: () => void;
  onCreateRecord?: (body: EntityRecordCreateRequestBody) => void;
  isCreatingRecord?: boolean;
  createRecordServerError?: ServerError | null;
  /** Called when user clicks "Re-validate All". */
  onRevalidate?: () => void;
  isRevalidating?: boolean;
}

export const EntityDetailViewUI: React.FC<EntityDetailViewUIProps> = ({
  entity,
  connectorInstanceName,
  recordCount,
  lastSyncAt,
  accessMode,
  onSync,
  isSyncing,
  bidirectionalFieldMappings,
  onRecordClick,
  tags,
  onAssignTag,
  onUnassignTag,
  onSearchTags,
  isWriteEnabled,
  onDelete,
  isDeleting,
  deleteServerError,
  deleteImpact,
  isLoadingDeleteImpact,
  deleteDialogOpen,
  onOpenDeleteDialog,
  onCloseDeleteDialog,
  onUpdate,
  isUpdating,
  updateServerError,
  editDialogOpen,
  onOpenEditDialog,
  onCloseEditDialog,
  createRecordDialogOpen,
  onOpenCreateRecordDialog,
  onCloseCreateRecordDialog,
  onCreateRecord,
  isCreatingRecord,
  createRecordServerError,
  onRevalidate,
  isRevalidating,
}) => {
  const navigate = useNavigate();

  const showSyncButton = accessMode === "import" || accessMode === "hybrid";

  // Column definitions captured from the first successful API response.
  // Used to populate the advanced filter builder and validate persisted filters.
  const [columnDefs, setColumnDefs] = React.useState<ResolvedColumn[]>(
    []
  );

  const { value: storedPagination, setValue: persistPagination } =
    useStorage<PaginationPersistedState>({
      key: `pagination:entity-records:${entity.id}`,
      defaultValue: {
        search: "",
        filters: {},
        sortBy: "created",
        sortOrder: "asc",
        limit: 10,
      },
    });

  // 4.4 — Strip persisted filters that reference removed columns on load.
  const cleanedInitialValue = React.useMemo(() => {
    if (
      !storedPagination.advancedFilters ||
      isFilterExpressionEmpty(storedPagination.advancedFilters) ||
      columnDefs.length === 0
    ) {
      return storedPagination;
    }
    const validKeys = new Set(columnDefs.map((c) => c.key));
    const [cleaned, removed] = stripInvalidColumns(
      storedPagination.advancedFilters,
      validKeys
    );
    if (removed.length > 0) {
      console.warn(
        `[AdvancedFilters] Stripped filters for removed columns: ${removed.join(", ")}`
      );
      // Persist the cleaned state immediately so the stale refs don't reload
      persistPagination({ ...storedPagination, advancedFilters: cleaned });
    }
    return { ...storedPagination, advancedFilters: cleaned };
  }, [storedPagination, columnDefs, persistPagination]);

  const pagination = usePagination({
    sortFields: [{ field: "created", label: "Created" }],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
    initialValue: cleanedInitialValue,
    onPersist: persistPagination,
    columnDefinitions: columnDefs,
  });

  const handleSort = (column: string) => {
    if (pagination.sortBy === column) {
      pagination.toggleSortOrder();
    } else {
      pagination.setSortBy(column);
      pagination.setSortOrder("asc");
    }
  };

  return (
    <Box>
      <Stack spacing={4}>
        <PageHeader
          breadcrumbs={[
            { label: "Dashboard", href: "/" },
            { label: "Entities", href: "/entities" },
            { label: entity.label },
          ]}
          onNavigate={(href) => navigate({ to: href })}
          title={entity.label}
          icon={<Icon name={IconName.DataObject} />}
          primaryAction={
            showSyncButton ? (
              <Button
                variant="contained"
                startIcon={<RefreshIcon />}
                onClick={onSync}
                disabled={isSyncing}
              >
                {isSyncing ? "Syncing…" : "Sync"}
              </Button>
            ) : undefined
          }
          secondaryActions={[
            ...(isWriteEnabled
              ? [{ label: "Edit", icon: <EditIcon />, onClick: () => onOpenEditDialog?.(), disabled: isUpdating }]
              : []),
            ...(isWriteEnabled
              ? [{ label: "Delete", icon: <DeleteIcon />, onClick: () => onOpenDeleteDialog?.(), color: "error" as const, disabled: isDeleting }]
              : []),
          ]}
        >
          <MetadataList
            items={[
              { label: "Key", value: entity.key, variant: "mono" },
              { label: "Connector", value: connectorInstanceName ?? "", hidden: !connectorInstanceName },
              { label: "Access mode", value: accessMode ?? "", hidden: !accessMode },
              { label: "Records", value: recordCount != null ? recordCount.toLocaleString() : "", hidden: recordCount == null },
              { label: "Last sync", value: lastSyncAt ? new Date(lastSyncAt).toLocaleString() : "", hidden: !lastSyncAt },
            ]}
          />
        </PageHeader>

        {/* Tags */}
        {tags && (
          <PageSection title="Tags" icon={<Icon name={IconName.Label} />}>
            <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
              {tags.map((tag) => (
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
                  onDelete={
                    onUnassignTag
                      ? () => onUnassignTag(tag.assignmentId)
                      : undefined
                  }
                />
              ))}
            </Stack>
            {onSearchTags && onAssignTag && (
              <Box sx={{ mt: 1, maxWidth: 300 }}>
                <TagAssignSelect
                  onSearch={onSearchTags}
                  onAssign={onAssignTag}
                />
              </Box>
            )}
          </PageSection>
        )}


        {/* Bidirectional consistency warnings */}
        {bidirectionalFieldMappings && bidirectionalFieldMappings.length > 0 && (
          <Stack spacing={1}>
            {bidirectionalFieldMappings.map((fm) => (
              <BidirectionalConsistencyBanner
                key={fm.id}
                fieldMappingId={fm.id}
                sourceField={fm.sourceField}
              />
            ))}
          </Stack>
        )}

        {/* Data table */}
        <PageSection
          title="Records"
          icon={<Icon name={IconName.DataObject} />}
          primaryAction={
            <Stack direction="row" spacing={1}>
              {onRevalidate && (
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<RefreshIcon />}
                  onClick={onRevalidate}
                  disabled={isRevalidating}
                >
                  {isRevalidating ? "Re-validating..." : "Re-validate All"}
                </Button>
              )}
              {isWriteEnabled && columnDefs.length > 0 && onOpenCreateRecordDialog && (
                <Button variant="outlined" size="small" startIcon={<AddIcon />} onClick={onOpenCreateRecordDialog}>
                  Create
                </Button>
              )}
            </Stack>
          }
        >
          <PaginationToolbar {...pagination.toolbarProps} />

          <Box sx={{ mt: 2 }}>
            <EntityRecordDataTable
              connectorEntityId={entity.id}
              query={pagination.queryParams as EntityRecordListRequestQuery}
            >
              {(listResult) => (
                <SyncTotal
                  total={listResult.data?.total}
                  setTotal={pagination.setTotal}
                >
                  <DataResult results={{ records: listResult }}>
                    {({
                      records,
                    }: {
                      records: EntityRecordListResponsePayload;
                    }) => {
                      const rowRecordId = new Map<
                        Record<string, unknown>,
                        string
                      >();
                      const rows = records.records.map((r) => {
                        const row = {
                          ...(r.normalizedData ?? {}),
                          isValid: r.isValid,
                        } as Record<string, unknown>;
                        rowRecordId.set(row, r.id);
                        return row;
                      });
                      const handleRowClick = (row: Record<string, unknown>) => {
                        const recordId = rowRecordId.get(row);
                        if (!recordId) return;
                        if (onRecordClick) {
                          onRecordClick(recordId);
                        } else {
                          void navigate({
                            to: `/entities/${entity.id}/records/${recordId}`,
                          });
                        }
                      };
                      return (
                        <SyncColumns
                          columns={records.columns}
                          setColumns={setColumnDefs}
                        >
                          <EntityRecordDataTableUI
                            connectorEntityId={entity.id}
                            rows={rows}
                            columns={records.columns}
                            source={records.source}
                            sortColumn={pagination.sortBy}
                            sortDirection={pagination.sortOrder}
                            onSort={handleSort}
                            onRowClick={handleRowClick}
                          />
                        </SyncColumns>
                      );
                    }}
                  </DataResult>
                </SyncTotal>
              )}
            </EntityRecordDataTable>
          </Box>
        </PageSection>

        {editDialogOpen !== undefined && onCloseEditDialog && onUpdate && (
          <EditConnectorEntityDialog
            open={!!editDialogOpen}
            onClose={onCloseEditDialog}
            entity={entity}
            onSubmit={onUpdate}
            isPending={isUpdating}
            serverError={updateServerError ?? null}
          />
        )}

        {createRecordDialogOpen !== undefined && onCloseCreateRecordDialog && onCreateRecord && (
          <CreateEntityRecordDialog
            open={!!createRecordDialogOpen}
            onClose={onCloseCreateRecordDialog}
            columns={columnDefs}
            onSubmit={onCreateRecord}
            isPending={isCreatingRecord}
            serverError={createRecordServerError ?? null}
          />
        )}

        {deleteDialogOpen !== undefined && onCloseDeleteDialog && onDelete && (
          <DeleteConnectorEntityDialog
            open={!!deleteDialogOpen}
            onClose={onCloseDeleteDialog}
            connectorEntityLabel={entity.label}
            onConfirm={onDelete}
            isPending={isDeleting}
            impact={deleteImpact ?? null}
            isLoadingImpact={isLoadingDeleteImpact}
            serverError={deleteServerError ?? null}
          />
        )}
      </Stack>
    </Box>
  );
};

// ── Container ───────────────────────────────────────────────────────

interface EntityDetailViewProps {
  entityId: string;
}

export const EntityDetailView: React.FC<EntityDetailViewProps> = ({
  entityId,
}) => {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { onSearch: handleSearchTags } = sdk.entityTags.search();

  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [createRecordDialogOpen, setCreateRecordDialogOpen] = useState(false);

  const entityResult = sdk.connectorEntities.get(entityId);
  const connectorInstanceId = entityResult.data?.connectorEntity?.connectorInstanceId ?? "";
  const instanceResult = sdk.connectorInstances.get(connectorInstanceId, {
    enabled: !!connectorInstanceId,
  });
  const connectorDefinitionId = instanceResult.data?.connectorInstance?.connectorDefinitionId ?? "";
  const definitionResult = sdk.connectorDefinitions.get(connectorDefinitionId, {
    enabled: !!connectorDefinitionId,
  });

  const countResult = sdk.entityRecords.count(entityId);
  const syncMutation = sdk.entityRecords.sync(entityId);
  const revalidateMutation = sdk.entityRecords.revalidate(entityId);
  const createRecordMutation = sdk.entityRecords.create(entityId);
  const updateMutation = sdk.connectorEntities.update(entityId);
  const deleteMutation = sdk.connectorEntities.delete(entityId);
  const impactQuery = sdk.connectorEntities.impact(entityId, {
    enabled: deleteDialogOpen,
  });
  const fieldMappingsResult = sdk.fieldMappings.list<FieldMappingListResponsePayload>({
    connectorEntityId: entityId,
    limit: 100,
    offset: 0,
    sortBy: "created",
    sortOrder: "asc",
  });

  const tagsResult = sdk.entityTagAssignments.listByEntity(entityId);
  const assignMutation = sdk.entityTagAssignments.assign(entityId);
  const unassignMutation = sdk.entityTagAssignments.unassign(entityId);

  const invalidateTags = useCallback(() => {
    queryClient.invalidateQueries({
      queryKey: queryKeys.entityTagAssignments.listByEntity(entityId),
    });
  }, [queryClient, entityId]);

  const handleAssignTag = useCallback(
    (entityTagId: string) => {
      assignMutation.mutate(
        { entityTagId },
        { onSuccess: invalidateTags }
      );
    },
    [assignMutation, invalidateTags]
  );

  const handleUnassignTag = useCallback(
    (assignmentId: string) => {
      unassignMutation.mutate(
        { assignmentId },
        { onSuccess: invalidateTags }
      );
    },
    [unassignMutation, invalidateTags]
  );

  const handleUpdate = useCallback(
    (body: ConnectorEntityPatchRequestBody) => {
      updateMutation.mutate(body, {
        onSuccess: () => {
          setEditDialogOpen(false);
          queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root });
          queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.get(entityId) });
        },
      });
    },
    [updateMutation, queryClient, entityId]
  );

  const handleDelete = useCallback(() => {
    deleteMutation.mutate(undefined, {
      onSuccess: () => {
        setDeleteDialogOpen(false);
        queryClient.invalidateQueries({ queryKey: queryKeys.connectorEntities.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.entityRecords.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.fieldMappings.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.entityGroups.root });
        navigate({ to: "/entities" });
      },
    });
  }, [deleteMutation, queryClient, navigate]);

  const handleRevalidate = useCallback(() => {
    revalidateMutation.mutate(undefined, {
      onSuccess: () => {
        queryClient.invalidateQueries({ queryKey: queryKeys.entityRecords.root });
        queryClient.invalidateQueries({ queryKey: queryKeys.jobs.root });
      },
    });
  }, [revalidateMutation, queryClient]);

  const handleCreateRecord = useCallback(
    (body: EntityRecordCreateRequestBody) => {
      createRecordMutation.mutate(body, {
        onSuccess: () => {
          setCreateRecordDialogOpen(false);
          createRecordMutation.reset();
          queryClient.invalidateQueries({ queryKey: queryKeys.entityRecords.root });
        },
      });
    },
    [createRecordMutation, queryClient]
  );

  return (
    <DataResult results={{ entity: entityResult }}>
      {({
        entity: entityPayload,
      }: {
        entity: ConnectorEntityGetResponsePayload;
      }) => {
        const entity = entityPayload.connectorEntity;
        const countData = countResult.data as
          | EntityRecordCountResponsePayload
          | undefined;

        const bidirectionalFieldMappings = (
          fieldMappingsResult.data?.fieldMappings ?? []
        )
          .filter((fm) => fm.refEntityKey !== null && fm.refNormalizedKey !== null)
          .map((fm) => ({ id: fm.id, sourceField: fm.sourceField }));

        const instance = instanceResult.data?.connectorInstance;
        const definition = definitionResult.data?.connectorDefinition;

        const isWriteEnabled = !!(
          definition?.capabilityFlags?.write &&
          (instance?.enabledCapabilityFlags?.write ?? true)
        );

        return (
          <EntityDetailViewUI
            entity={entity}
            connectorInstanceName={instance?.name}
            recordCount={countData?.total}
            accessMode={
              definition?.capabilityFlags
                ? definition.capabilityFlags.sync && definition.capabilityFlags.query
                  ? "hybrid"
                  : definition.capabilityFlags.sync
                    ? "import"
                    : definition.capabilityFlags.query
                      ? "live"
                      : undefined
                : undefined
            }
            onSync={() => syncMutation.mutate(undefined)}
            isSyncing={syncMutation.isPending}
            bidirectionalFieldMappings={
              bidirectionalFieldMappings.length > 0
                ? bidirectionalFieldMappings
                : undefined
            }
            tags={tagsResult.data?.tags}
            onAssignTag={handleAssignTag}
            onUnassignTag={handleUnassignTag}
            onSearchTags={handleSearchTags}
            isWriteEnabled={isWriteEnabled}
            onDelete={handleDelete}
            isDeleting={deleteMutation.isPending}
            deleteServerError={toServerError(deleteMutation.error)}
            deleteImpact={impactQuery.data ?? null}
            isLoadingDeleteImpact={impactQuery.isLoading && deleteDialogOpen}
            deleteDialogOpen={deleteDialogOpen}
            onOpenDeleteDialog={() => setDeleteDialogOpen(true)}
            onCloseDeleteDialog={() => setDeleteDialogOpen(false)}
            onUpdate={handleUpdate}
            isUpdating={updateMutation.isPending}
            updateServerError={toServerError(updateMutation.error)}
            editDialogOpen={editDialogOpen}
            onOpenEditDialog={() => setEditDialogOpen(true)}
            onCloseEditDialog={() => setEditDialogOpen(false)}
            createRecordDialogOpen={createRecordDialogOpen}
            onOpenCreateRecordDialog={() => setCreateRecordDialogOpen(true)}
            onCloseCreateRecordDialog={() => setCreateRecordDialogOpen(false)}
            onCreateRecord={handleCreateRecord}
            isCreatingRecord={createRecordMutation.isPending}
            createRecordServerError={toServerError(createRecordMutation.error)}
            onRevalidate={handleRevalidate}
            isRevalidating={revalidateMutation.isPending}
          />
        );
      }}
    </DataResult>
  );
};

import React from "react";

import type {
  ConnectorEntityGetResponsePayload,
  ColumnDefinitionSummary,
  EntityRecordListRequestQuery,
  EntityRecordListResponsePayload,
  EntityRecordCountResponsePayload,
} from "@portalai/core/contracts";
import { Box, Breadcrumbs, Stack, Typography } from "@portalai/core/ui";
import { IconName } from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import Button from "@mui/material/Button";
import RefreshIcon from "@mui/icons-material/Refresh";

import { useNavigate } from "@tanstack/react-router";

import { sdk } from "../api/sdk";
import DataResult from "../components/DataResult.component";
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

// ── Pure UI ─────────────────────────────────────────────────────────

export interface EntityDetailViewUIProps {
  entity: ConnectorEntityGetResponsePayload["connectorEntity"];
  connectorInstanceName?: string;
  recordCount?: number;
  lastSyncAt?: number | null;
  accessMode?: string;
  onSync?: () => void;
  isSyncing?: boolean;
  /** Called when a record row is clicked. Overrides the default navigation behaviour — useful for testing. */
  onRecordClick?: (recordId: string) => void;
}

export const EntityDetailViewUI: React.FC<EntityDetailViewUIProps> = ({
  entity,
  connectorInstanceName,
  recordCount,
  lastSyncAt,
  accessMode,
  onSync,
  isSyncing,
  onRecordClick,
}) => {
  const navigate = useNavigate();

  const showSyncButton = accessMode === "import" || accessMode === "hybrid";

  // Column definitions captured from the first successful API response.
  // Used to populate the advanced filter builder and validate persisted filters.
  const [columnDefs, setColumnDefs] = React.useState<ColumnDefinitionSummary[]>(
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
        <Breadcrumbs
          items={[
            { label: "Dashboard", href: "/", icon: IconName.Home },
            { label: "Entities", href: "/entities" },
            { label: entity.label },
          ]}
          onNavigate={(href) => navigate({ to: href })}
        />

        {/* Header */}
        <Box>
          <Stack direction="row" spacing={2} alignItems="center" sx={{ mb: 1 }}>
            <Typography variant="h1">{entity.label}</Typography>
            <Chip
              label={entity.key}
              size="small"
              variant="outlined"
              sx={{ fontFamily: "monospace" }}
            />
          </Stack>

          <Stack spacing={0.5}>
            {connectorInstanceName && (
              <Typography variant="body2" color="text.secondary">
                Connector: {connectorInstanceName}
              </Typography>
            )}
            {accessMode && (
              <Typography variant="body2" color="text.secondary">
                Access mode: {accessMode}
              </Typography>
            )}
            {recordCount != null && (
              <Typography variant="body2" color="text.secondary">
                Records: {recordCount.toLocaleString()}
              </Typography>
            )}
            {lastSyncAt && (
              <Typography variant="body2" color="text.secondary">
                Last sync: {new Date(lastSyncAt).toLocaleString()}
              </Typography>
            )}
          </Stack>

          {showSyncButton && (
            <Box sx={{ mt: 2 }}>
              <Button
                variant="outlined"
                size="small"
                startIcon={<RefreshIcon />}
                onClick={onSync}
                disabled={isSyncing}
              >
                {isSyncing ? "Syncing…" : "Sync"}
              </Button>
            </Box>
          )}
        </Box>

        {/* Data table */}
        <Box>
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
                        const row = (r.normalizedData ?? {}) as Record<
                          string,
                          unknown
                        >;
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
        </Box>
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
  const entityResult = sdk.connectorEntities.get(entityId);
  const countResult = sdk.entityRecords.count(entityId);
  const syncMutation = sdk.entityRecords.sync(entityId);

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

        return (
          <EntityDetailViewUI
            entity={entity}
            recordCount={countData?.total}
            onSync={() => syncMutation.mutate(undefined)}
            isSyncing={syncMutation.isPending}
          />
        );
      }}
    </DataResult>
  );
};

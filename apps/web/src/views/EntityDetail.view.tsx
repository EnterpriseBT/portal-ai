import React from "react";

import type {
  ConnectorEntityGetResponsePayload,
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
import {
  usePagination,
  PaginationToolbar,
  type PaginationPersistedState,
} from "../components/PaginationToolbar.component";
import { useStorage } from "../utils/storage.util";
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
}

export const EntityDetailViewUI: React.FC<EntityDetailViewUIProps> = ({
  entity,
  connectorInstanceName,
  recordCount,
  lastSyncAt,
  accessMode,
  onSync,
  isSyncing,
}) => {
  const navigate = useNavigate();

  const showSyncButton = accessMode === "import" || accessMode === "hybrid";

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

  const pagination = usePagination({
    sortFields: [{ field: "created", label: "Created" }],
    defaultSortBy: "created",
    defaultSortOrder: "asc",
    initialValue: storedPagination,
    onPersist: persistPagination,
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
                      const rows = records.records.map(
                        (r) =>
                          (r.normalizedData ?? {}) as Record<string, unknown>
                      );
                      return (
                        <EntityRecordDataTableUI
                          connectorEntityId={entity.id}
                          rows={rows}
                          columns={records.columns}
                          source={records.source}
                          sortColumn={pagination.sortBy}
                          sortDirection={pagination.sortOrder}
                          onSort={handleSort}
                        />
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

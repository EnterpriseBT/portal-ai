import React from "react";

import type { UseQueryResult } from "@tanstack/react-query";
import type {
  EntityRecordListRequestQuery,
  EntityRecordListResponsePayload,
  ColumnDefinitionSummary,
} from "@portalai/core/contracts";
import { SORTABLE_COLUMN_TYPES } from "@portalai/core/models";
import { Stack } from "@portalai/core/ui";
import {
  DataTable,
  useColumnConfig,
  type DataTableColumn,
  type ColumnConfig,
} from "@portalai/core/ui";
import Chip from "@mui/material/Chip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

import { sdk } from "../api/sdk";
import { ApiError } from "../utils";
import { Formatter } from "../utils/format.util";
import { useStorage } from "../utils/storage.util";

// ── Data component ──────────────────────────────────────────────────

export interface EntityRecordDataTableProps {
  connectorEntityId: string;
  query: EntityRecordListRequestQuery;
  children: (
    data: UseQueryResult<EntityRecordListResponsePayload, ApiError>
  ) => React.ReactNode;
}

export const EntityRecordDataTable = (props: EntityRecordDataTableProps) => {
  const res = sdk.entityRecords.list(props.connectorEntityId, props.query);
  return props.children(res);
};

// ── Helpers ─────────────────────────────────────────────────────────

function toDataTableColumns(
  columns: ColumnDefinitionSummary[]
): DataTableColumn[] {
  return columns.map((col) => ({
    key: col.key,
    label: col.label,
    sortable: SORTABLE_COLUMN_TYPES.has(col.type),
    format: (value: unknown) => Formatter.format(value, col.type),
  }));
}

// ── Pure UI component ───────────────────────────────────────────────

export interface EntityRecordDataTableUIProps {
  connectorEntityId: string;
  rows: Record<string, unknown>[];
  columns: ColumnDefinitionSummary[];
  source: "cache" | "live";
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (column: string) => void;
}

export const EntityRecordDataTableUI: React.FC<
  EntityRecordDataTableUIProps
> = ({ connectorEntityId, rows, columns, source, sortColumn, sortDirection, onSort }) => {
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("md"));

  const dataTableColumns = React.useMemo(
    () => toDataTableColumns(columns),
    [columns]
  );

  const { value: storedConfig, setValue: persistConfig } =
    useStorage<ColumnConfig[]>({
      key: `column-config:entity-records:${connectorEntityId}`,
      defaultValue: [],
    });

  const [columnConfig, setColumnConfig] = useColumnConfig(dataTableColumns, {
    initialValue: storedConfig.length > 0 ? storedConfig : undefined,
    onPersist: persistConfig,
    defaultVisibleCount: isSmallScreen ? 5 : 8,
  });

  return (
    <Stack spacing={1}>
      <DataTable
        header={
          <Chip
            label={source === "cache" ? "Cached" : "Live"}
            size="small"
            variant="outlined"
            color={source === "live" ? "success" : "default"}
          />
        }
        columns={dataTableColumns}
        rows={rows}
        sortColumn={sortColumn}
        sortDirection={sortDirection}
        onSort={onSort}
        emptyMessage="No records found"
        columnConfig={columnConfig}
        onColumnConfigChange={setColumnConfig}
      />
    </Stack>
  );
};

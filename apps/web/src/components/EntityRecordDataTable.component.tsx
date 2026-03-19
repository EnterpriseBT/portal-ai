import React from "react";

import type { UseQueryResult } from "@tanstack/react-query";
import type {
  EntityRecordListRequestQuery,
  EntityRecordListResponsePayload,
  ColumnDefinitionSummary,
} from "@portalai/core/contracts";
import { Stack } from "@portalai/core/ui";
import {
  DataTable,
  useColumnConfig,
  type DataTableColumn,
} from "@portalai/core/ui";
import Chip from "@mui/material/Chip";

import { sdk } from "../api/sdk";
import { ApiError } from "../utils";
import { Formatter } from "../utils/format.util";

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

const SORTABLE_COLUMN_TYPES = new Set([
  "string",
  "number",
  "date",
  "datetime",
  "currency",
]);

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
  rows: Record<string, unknown>[];
  columns: ColumnDefinitionSummary[];
  source: "cache" | "live";
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (column: string) => void;
}

export const EntityRecordDataTableUI: React.FC<
  EntityRecordDataTableUIProps
> = ({ rows, columns, source, sortColumn, sortDirection, onSort }) => {
  const dataTableColumns = React.useMemo(
    () => toDataTableColumns(columns),
    [columns]
  );
  const [columnConfig, setColumnConfig] = useColumnConfig(dataTableColumns);

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

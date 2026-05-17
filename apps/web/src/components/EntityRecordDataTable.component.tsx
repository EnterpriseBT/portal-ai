import React from "react";

import type { UseQueryResult } from "@tanstack/react-query";
import type {
  EntityRecordListRequestQuery,
  EntityRecordListResponsePayload,
  ResolvedColumn,
} from "@portalai/core/contracts";
import { SORTABLE_COLUMN_TYPES } from "@portalai/core/models";
import { Stack } from "@portalai/core/ui";
import {
  DataTable,
  useColumnConfig,
  type DataTableColumn,
  type ColumnConfig,
} from "@portalai/core/ui";
import CancelIcon from "@mui/icons-material/Cancel";
import CheckCircleIcon from "@mui/icons-material/CheckCircle";
import Chip from "@mui/material/Chip";
import useMediaQuery from "@mui/material/useMediaQuery";
import { useTheme } from "@mui/material/styles";

import Box from "@mui/material/Box";
import Tooltip from "@mui/material/Tooltip";

import { sdk } from "../api/sdk";
import { ApiError } from "../utils";
import { Formatter } from "../utils/format.util";
import { useStorage } from "../utils/storage.util";
import { EntityRecordCellCode } from "./EntityRecordCellCode.component";

/**
 * Soft cap on inline cell width so a 4kB note doesn't blow the
 * column out across the page. The wrapper sets a max-width + CSS
 * truncation; a Tooltip on hover surfaces the full value when the
 * user wants the rest. Tuned to roughly the width of two normal
 * text columns at the default font size.
 */
const CELL_MAX_WIDTH_PX = 280;

const TruncatedCell: React.FC<{ text: string }> = ({ text }) => {
  if (!text) return <>{text}</>;
  return (
    <Tooltip title={text} placement="top" arrow>
      <Box
        component="span"
        sx={{
          display: "inline-block",
          maxWidth: CELL_MAX_WIDTH_PX,
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
          verticalAlign: "bottom",
        }}
      >
        {text}
      </Box>
    </Tooltip>
  );
};

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

const VALID_COLUMN: DataTableColumn = {
  key: "isValid",
  label: "Valid",
  sortable: false,
  render: (value: unknown) =>
    value === false ? (
      <CancelIcon fontSize="small" color="error" />
    ) : (
      <CheckCircleIcon fontSize="small" color="success" />
    ),
};

function toDataTableColumns(columns: ResolvedColumn[]): DataTableColumn[] {
  const cols: DataTableColumn[] = columns.map((col) => {
    // Use normalizedKey as the header label since it's the field-mapping-level
    // identifier; show the column definition label as a caption alongside type.
    const headerLabel = col.normalizedKey;
    const caption =
      col.normalizedKey !== col.key ? `${col.label} · ${col.type}` : col.type;

    if (
      col.type === "json" ||
      col.type === "array" ||
      col.type === "reference-array"
    ) {
      return {
        key: col.normalizedKey,
        label: headerLabel,
        caption,
        sortable: SORTABLE_COLUMN_TYPES.has(col.type),
        render: (value: unknown) => (
          <EntityRecordCellCode
            value={value}
            type={col.type as "json" | "array" | "reference-array"}
          />
        ),
      };
    }
    return {
      key: col.normalizedKey,
      label: headerLabel,
      caption,
      sortable: SORTABLE_COLUMN_TYPES.has(col.type),
      // `render` (not `format`) so we can wrap the formatted value
      // in a truncating Box + Tooltip. Long free-text values (notes,
      // abstracts, links) used to stretch a single column past the
      // viewport on wide-table entities; now they cap at
      // CELL_MAX_WIDTH_PX with an ellipsis and reveal the full text
      // on hover.
      render: (value: unknown) => {
        const formatted = Formatter.format(value, col.type, {
          canonicalFormat: col.canonicalFormat,
        });
        return <TruncatedCell text={formatted} />;
      },
    };
  });

  cols.push(VALID_COLUMN);
  return cols;
}

// ── Pure UI component ───────────────────────────────────────────────

export interface EntityRecordDataTableUIProps {
  connectorEntityId: string;
  rows: Record<string, unknown>[];
  columns: ResolvedColumn[];
  source: "cache" | "live";
  sortColumn?: string;
  sortDirection?: "asc" | "desc";
  onSort?: (column: string) => void;
  onRowClick?: (row: Record<string, unknown>) => void;
}

export const EntityRecordDataTableUI: React.FC<
  EntityRecordDataTableUIProps
> = ({
  connectorEntityId,
  rows,
  columns,
  source,
  sortColumn,
  sortDirection,
  onSort,
  onRowClick,
}) => {
  const theme = useTheme();
  const isSmallScreen = useMediaQuery(theme.breakpoints.down("md"));

  const dataTableColumns = React.useMemo(
    () => toDataTableColumns(columns),
    [columns]
  );

  const { value: storedConfig, setValue: persistConfig } = useStorage<
    ColumnConfig[]
  >({
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
        onRowClick={
          onRowClick
            ? (row: Record<string, unknown>) => onRowClick(row)
            : undefined
        }
      />
    </Stack>
  );
};

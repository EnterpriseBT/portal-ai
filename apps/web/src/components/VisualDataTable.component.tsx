import React, { useState } from "react";
import { Box, Button, Typography } from "@mui/material";
import { keepPreviousData } from "@tanstack/react-query";

import { DataTableBlock, StatusMessage } from "@portalai/core/ui";

import { sdk } from "../api/sdk";
import { toServerError } from "../utils/api.util";
import { serverErrorMessage } from "../utils/permission-denied.util";
import { dataCapNote } from "../utils/data-cap-note.util";

import type { DataTableBlockPaging } from "@portalai/core/ui";
import type { ServerError } from "../utils/api.util";

/** Where a chart's or map's data lives (#796): the rows it holds, or the
 *  staged query handle it reads from. */
export type VisualDataSource =
  | {
      kind: "inline";
      rows: Record<string, unknown>[];
      /** Columns to show, in order. Absent ⇒ the first row's keys. */
      columns?: string[];
    }
  | {
      kind: "handle";
      handleId: string;
      /** The true total the query matched, when known (#340). */
      matchedCount?: number;
      matchedCountExact?: boolean;
      /** Staging stopped at `HANDLE_ROW_CAP`: the handle holds the first rows. */
      truncated?: boolean;
      /** Columns to show, in order. Absent ⇒ the first page's keys. */
      columns?: string[];
    };

const DEFAULT_ROWS_PER_PAGE = 10;
const READ_HANDLE_EXPIRED = "READ_HANDLE_EXPIRED";

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface VisualDataTableUIProps {
  /** The table's name: "Data for <title>". */
  label: string;
  columns: string[];
  rows: Record<string, unknown>[];
  /** Server paging for a handle-backed result. Absent ⇒ client-side table. */
  paging?: DataTableBlockPaging;
  /** Says the table holds the first rows of a larger result. */
  capNote?: string;
  error?: ServerError | null;
  /** The staged rows aged out (24h): offer Refresh instead of a table. */
  expired?: boolean;
  onRefresh?: () => void;
}

export const VisualDataTableUI: React.FC<VisualDataTableUIProps> = ({
  label,
  columns,
  rows,
  paging,
  capNote,
  error = null,
  expired = false,
  onRefresh,
}) => {
  if (expired) {
    return (
      <Box>
        <Typography variant="body2">
          This data has expired. Refresh to load it again.
        </Typography>
        {onRefresh ? (
          <Button size="small" onClick={onRefresh}>
            Refresh
          </Button>
        ) : null}
      </Box>
    );
  }
  if (error) {
    return (
      <StatusMessage
        variant="error"
        message={serverErrorMessage(error, "Couldn't load this data.")}
      />
    );
  }
  return (
    <Box>
      {capNote ? (
        <Typography variant="caption" color="text.secondary">
          {capNote}
        </Typography>
      ) : null}
      <DataTableBlock
        label={label}
        columns={columns}
        rows={rows}
        paging={paging}
      />
    </Box>
  );
};

// ── Container ──────────────────────────────────────────────────────────

export interface VisualDataTableProps {
  label: string;
  source: VisualDataSource;
  /** The widget's refresh, offered when the handle has expired. */
  onRefresh?: () => void;
}

/** Reads a handle's staged rows a page at a time, by offset (the snapshot's
 *  batch keys make a deep page cost what the first does). Inline rows need
 *  no request. Key it by handle id so a new delivery starts at page one. */
export const VisualDataTable: React.FC<VisualDataTableProps> = ({
  label,
  source,
  onRefresh,
}) => {
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(DEFAULT_ROWS_PER_PAGE);
  const isHandle = source.kind === "handle";

  const snapshot = sdk.portalSql.handleSnapshot(
    isHandle ? source.handleId : "",
    { offset: page * rowsPerPage, limit: rowsPerPage },
    { enabled: isHandle, placeholderData: keepPreviousData }
  );

  if (source.kind === "inline") {
    return (
      <VisualDataTableUI
        label={label}
        columns={source.columns ?? Object.keys(source.rows[0] ?? {})}
        rows={source.rows}
      />
    );
  }

  const pageRows = snapshot.data?.rows ?? [];
  const total = snapshot.data?.total ?? 0;
  const error = snapshot.error;

  const capNote = dataCapNote(total, source);

  return (
    <VisualDataTableUI
      label={label}
      columns={source.columns ?? Object.keys(pageRows[0] ?? {})}
      rows={pageRows}
      paging={{
        total,
        page,
        rowsPerPage,
        onPageChange: setPage,
        onRowsPerPageChange: (next) => {
          setRowsPerPage(next);
          setPage(0);
        },
        loading: snapshot.isFetching,
      }}
      capNote={capNote}
      expired={error?.code === READ_HANDLE_EXPIRED}
      error={toServerError(error)}
      onRefresh={onRefresh}
    />
  );
};

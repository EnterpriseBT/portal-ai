import React, { useEffect } from "react";

import { Chip, CircularProgress } from "@mui/material";

import {
  Box,
  DataTable,
  Stack,
  StatusMessage,
  type DataTableColumn,
} from "@portalai/core/ui";
import { AUDIT_ACTIONS } from "@portalai/core/models";
import type { AuditLogEntry } from "@portalai/core/models";
import type { AuditLogListRequestQuery } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import {
  PaginationToolbar,
  usePagination,
  type FilterOption,
  type PaginationToolbarProps,
} from "./PaginationToolbar.component";

// ── Columns ────────────────────────────────────────────────────────────

const monospace = (value: unknown) => {
  const text = value == null || value === "" ? "—" : String(value);
  return (
    <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>
      {text}
    </span>
  );
};

/** `created` is the only sortable key — it mirrors the read API's allow-map. */
const AUDIT_COLUMNS: DataTableColumn[] = [
  {
    key: "created",
    label: "When",
    sortable: true,
    format: (value) => new Date(Number(value)).toLocaleString(),
  },
  { key: "userId", label: "Actor", render: monospace },
  { key: "action", label: "Action", render: (value) => String(value) },
  {
    key: "targetType",
    label: "Target",
    render: (_value, row) => {
      const targetType = row.targetType as string | null;
      const targetId = row.targetId as string | null;
      if (!targetType) return "—";
      return targetId ? `${targetType} · ${targetId}` : targetType;
    },
  },
  {
    key: "outcome",
    label: "Outcome",
    render: (value) => (
      <Chip
        size="small"
        variant="outlined"
        color={value === "success" ? "success" : "error"}
        label={String(value)}
      />
    ),
  },
  { key: "sourceIp", label: "IP", render: monospace },
  { key: "userAgent", label: "User agent", render: monospace },
];

// ── Filter options ──────────────────────────────────────────────────────

/** Humanize a dotted action slug, e.g. `connector.credential.create`
 *  → "Connector · Credential · Create". */
const humanizeAction = (action: string): string =>
  action
    .split(".")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" · ");

const ACTION_OPTIONS: FilterOption[] = AUDIT_ACTIONS.map((action) => ({
  label: humanizeAction(action),
  value: action,
}));

const OUTCOME_OPTIONS: FilterOption[] = [
  { label: "Success", value: "success" },
  { label: "Failure", value: "failure" },
];

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface AuditLogActivityUIProps {
  entries: AuditLogEntry[];
  /** Filters / sort / page controls — from `usePagination`. */
  toolbarProps: PaginationToolbarProps;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (column: string) => void;
  isLoading?: boolean;
  /** A fetch failure renders inline (not a blank panel), per the house
   *  render-not-toast convention for query errors. */
  error?: Error | null;
}

export const AuditLogActivityUI: React.FC<AuditLogActivityUIProps> = ({
  entries,
  toolbarProps,
  sortBy,
  sortOrder,
  onSort,
  isLoading = false,
  error = null,
}) => (
  <Stack spacing={2}>
    <PaginationToolbar {...toolbarProps} />
    {error ? (
      <StatusMessage variant="error" error={error} />
    ) : isLoading ? (
      <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
        <CircularProgress aria-label="Loading audit log" />
      </Box>
    ) : (
      <DataTable
        columns={AUDIT_COLUMNS}
        rows={entries as unknown as Record<string, unknown>[]}
        sortColumn={sortBy}
        sortDirection={sortOrder}
        onSort={onSort}
        emptyMessage="No audit-log entries match the current filters."
      />
    )}
  </Stack>
);

// ── Container ──────────────────────────────────────────────────────────

/** The owner-only audit-log activity view (#596) — mounted lazily behind
 *  the Settings › Activity tab, so the query fires only while that tab is
 *  active. The server enforces the owner gate (403); this view assumes the
 *  caller cleared it. */
export const AuditLogActivity: React.FC = () => {
  const pagination = usePagination({
    sortFields: [{ field: "created", label: "When" }],
    defaultSortBy: "created",
    defaultSortOrder: "desc",
    limit: 20,
    filters: [
      {
        type: "select",
        field: "action",
        label: "Action",
        options: ACTION_OPTIONS,
      },
      {
        type: "select",
        field: "outcome",
        label: "Outcome",
        options: OUTCOME_OPTIONS,
      },
    ],
  });

  const auditQuery = sdk.auditLog.list(
    pagination.queryParams as AuditLogListRequestQuery
  );

  // Feed the response total back into the toolbar's page controls.
  const total = auditQuery.data?.total;
  const { setTotal } = pagination;
  useEffect(() => {
    if (total !== undefined) setTotal(total);
  }, [total, setTotal]);

  const handleSort = (column: string) => {
    if (pagination.sortBy === column) {
      pagination.toggleSortOrder();
    } else {
      pagination.setSortBy(column);
    }
  };

  return (
    <AuditLogActivityUI
      entries={auditQuery.data?.entries ?? []}
      toolbarProps={pagination.toolbarProps}
      sortBy={pagination.sortBy}
      sortOrder={pagination.sortOrder}
      onSort={handleSort}
      isLoading={auditQuery.isLoading}
      error={auditQuery.error}
    />
  );
};

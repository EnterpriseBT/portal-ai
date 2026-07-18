import React, { useEffect, useState } from "react";

import { Chip, CircularProgress } from "@mui/material";

import {
  Box,
  Button,
  DataTable,
  Modal,
  Stack,
  type DataTableColumn,
} from "@portalai/core/ui";
import type { ToolUsageLedgerEntry } from "@portalai/core/models";
import type { UsageLedgerListRequestQuery } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";
import {
  PaginationToolbar,
  usePagination,
  type PaginationToolbarProps,
} from "./PaginationToolbar.component";

// ── Columns ────────────────────────────────────────────────────────────

const monospace = (value: unknown) => (
  <span style={{ fontFamily: "monospace", fontSize: "0.8125rem" }}>
    {String(value ?? "")}
  </span>
);

/** Sortable keys mirror the endpoint's allow-map: created | units | toolName. */
const LEDGER_COLUMNS: DataTableColumn[] = [
  { key: "toolName", label: "Tool", sortable: true, render: monospace },
  {
    key: "costClass",
    label: "Class",
    render: (value) => (
      <Chip size="small" variant="outlined" label={String(value)} />
    ),
  },
  { key: "units", label: "Units", sortable: true },
  {
    key: "created",
    label: "When",
    sortable: true,
    format: (value) => new Date(Number(value)).toLocaleString(),
  },
  { key: "userId", label: "Who", render: monospace },
];

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface UsageLedgerDialogUIProps {
  open: boolean;
  onClose: () => void;
  entries: ToolUsageLedgerEntry[];
  /** Search / filters / sort / page controls — from `usePagination`. */
  toolbarProps: PaginationToolbarProps;
  sortBy: string;
  sortOrder: "asc" | "desc";
  onSort: (column: string) => void;
  isLoading?: boolean;
}

export const UsageLedgerDialogUI: React.FC<UsageLedgerDialogUIProps> = ({
  open,
  onClose,
  entries,
  toolbarProps,
  sortBy,
  sortOrder,
  onSort,
  isLoading = false,
}) => (
  <Modal
    open={open}
    onClose={onClose}
    title="Itemized usage"
    maxWidth="md"
    fullWidth
    actions={
      <Button type="button" variant="outlined" onClick={onClose}>
        Close
      </Button>
    }
  >
    {/* pt clears the filter-count badge: it protrudes above the toolbar's
        buttons, and DialogContent's zeroed top padding (title present)
        would otherwise clip it at the scroll boundary. */}
    <Stack spacing={2} sx={{ pt: 1.5 }}>
      <PaginationToolbar {...toolbarProps} />
      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress aria-label="Loading usage ledger" />
        </Box>
      ) : (
        <DataTable
          columns={LEDGER_COLUMNS}
          rows={entries as unknown as Record<string, unknown>[]}
          sortColumn={sortBy}
          sortDirection={sortOrder}
          onSort={onSort}
          emptyMessage="No charged tool calls match the current filters."
        />
      )}
    </Stack>
  </Modal>
);

// ── Container ──────────────────────────────────────────────────────────

export interface UsageLedgerDialogProps {
  open: boolean;
  onClose: () => void;
  /** The current billing period — the dialog's default filter. */
  defaultPeriodId?: string;
}

export const UsageLedgerDialog: React.FC<UsageLedgerDialogProps> = ({
  open,
  onClose,
  defaultPeriodId,
}) => {
  const pagination = usePagination({
    sortFields: [
      { field: "created", label: "When" },
      { field: "units", label: "Units" },
      { field: "toolName", label: "Tool" },
    ],
    defaultSortBy: "created",
    defaultSortOrder: "desc",
    limit: 10,
    filters: [
      {
        type: "text",
        field: "periodId",
        label: "Period",
        placeholder: "e.g. 2026-07",
        defaultValue: defaultPeriodId ? [defaultPeriodId] : [],
      },
      {
        type: "text",
        field: "toolName",
        label: "Tool",
        placeholder: "exact tool name",
      },
    ],
  });

  // Rewind to the first page whenever the dialog reopens — the
  // "adjust state during render" pattern (not an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) pagination.setOffset(0);
  }

  const ledgerQuery = sdk.organizations.usageLedger(
    pagination.queryParams as UsageLedgerListRequestQuery,
    { enabled: open }
  );

  // Feed the response total back into the toolbar's page controls.
  const total = ledgerQuery.data?.total;
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
    <UsageLedgerDialogUI
      open={open}
      onClose={onClose}
      entries={ledgerQuery.data?.entries ?? []}
      toolbarProps={pagination.toolbarProps}
      sortBy={pagination.sortBy}
      sortOrder={pagination.sortOrder}
      onSort={handleSort}
      isLoading={ledgerQuery.isLoading}
    />
  );
};

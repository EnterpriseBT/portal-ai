import React, { useState } from "react";

import {
  Chip,
  CircularProgress,
  Table,
  TableBody,
  TableCell,
  TableContainer,
  TableHead,
  TablePagination,
  TableRow,
} from "@mui/material";

import { Box, Button, Modal, Stack, Typography } from "@portalai/core/ui";
import type { ToolUsageLedgerEntry } from "@portalai/core/models";

import { sdk } from "../api/sdk";

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface UsageLedgerDialogUIProps {
  open: boolean;
  onClose: () => void;
  entries: ToolUsageLedgerEntry[];
  /** Filter-scoped total across all pages. */
  total: number;
  page: number;
  rowsPerPage: number;
  onPageChange: (page: number) => void;
  onRowsPerPageChange: (rowsPerPage: number) => void;
  /** Active billing-period filter; null = all periods. */
  periodId: string | null;
  /** Clears the period filter (the chip's delete affordance). */
  onClearPeriod: () => void;
  isLoading?: boolean;
}

export const UsageLedgerDialogUI: React.FC<UsageLedgerDialogUIProps> = ({
  open,
  onClose,
  entries,
  total,
  page,
  rowsPerPage,
  onPageChange,
  onRowsPerPageChange,
  periodId,
  onClearPeriod,
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
    <Stack spacing={2}>
      <Stack direction="row" spacing={1} alignItems="center">
        <Typography variant="body2" color="text.secondary">
          One row per charged tool call.
        </Typography>
        {periodId && (
          <Chip
            size="small"
            label={`Period ${periodId}`}
            onDelete={onClearPeriod}
          />
        )}
      </Stack>

      {isLoading ? (
        <Box sx={{ display: "flex", justifyContent: "center", py: 4 }}>
          <CircularProgress aria-label="Loading usage ledger" />
        </Box>
      ) : entries.length === 0 ? (
        <Typography variant="body2" color="text.secondary" sx={{ py: 4 }}>
          No charged tool calls{periodId ? " in this period" : ""} yet.
        </Typography>
      ) : (
        <TableContainer>
          <Table size="small" aria-label="Usage ledger entries">
            <TableHead>
              <TableRow>
                <TableCell>Tool</TableCell>
                <TableCell>Class</TableCell>
                <TableCell align="right">Units</TableCell>
                <TableCell>When</TableCell>
                <TableCell>Who</TableCell>
              </TableRow>
            </TableHead>
            <TableBody>
              {entries.map((entry) => (
                <TableRow key={entry.id} hover>
                  <TableCell>
                    <Typography
                      variant="caption"
                      sx={{ fontFamily: "monospace" }}
                    >
                      {entry.toolName}
                    </Typography>
                  </TableCell>
                  <TableCell>
                    <Chip
                      size="small"
                      variant="outlined"
                      label={entry.costClass}
                    />
                  </TableCell>
                  <TableCell align="right">{entry.units}</TableCell>
                  <TableCell>
                    {new Date(entry.created).toLocaleString()}
                  </TableCell>
                  <TableCell>
                    <Typography
                      variant="caption"
                      sx={{ fontFamily: "monospace" }}
                    >
                      {entry.userId}
                    </Typography>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </TableContainer>
      )}

      <TablePagination
        component="div"
        count={total}
        page={page}
        onPageChange={(_, p) => onPageChange(p)}
        rowsPerPage={rowsPerPage}
        rowsPerPageOptions={[10, 25, 50]}
        onRowsPerPageChange={(e) =>
          onRowsPerPageChange(parseInt(e.target.value, 10))
        }
      />
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
  const [page, setPage] = useState(0);
  const [rowsPerPage, setRowsPerPage] = useState(10);
  const [periodId, setPeriodId] = useState<string | null>(
    defaultPeriodId ?? null
  );

  // Reset pagination + filter whenever the dialog reopens — the
  // "adjust state during render" pattern (not an effect).
  const [prevOpen, setPrevOpen] = useState(open);
  if (open !== prevOpen) {
    setPrevOpen(open);
    if (open) {
      setPage(0);
      setPeriodId(defaultPeriodId ?? null);
    }
  }

  const ledgerQuery = sdk.organizations.usageLedger(
    {
      limit: rowsPerPage,
      offset: page * rowsPerPage,
      sortBy: "created",
      sortOrder: "desc",
      ...(periodId ? { periodId } : {}),
    },
    { enabled: open }
  );

  return (
    <UsageLedgerDialogUI
      open={open}
      onClose={onClose}
      entries={ledgerQuery.data?.entries ?? []}
      total={ledgerQuery.data?.total ?? 0}
      page={page}
      rowsPerPage={rowsPerPage}
      onPageChange={setPage}
      onRowsPerPageChange={(rows) => {
        setRowsPerPage(rows);
        setPage(0);
      }}
      periodId={periodId}
      onClearPeriod={() => {
        setPeriodId(null);
        setPage(0);
      }}
      isLoading={ledgerQuery.isLoading}
    />
  );
};

import React, { useMemo } from "react";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";

import { DataTableBlock, WidgetFreshnessBar } from "@portalai/core";
import { DataTableBlockContentSchema } from "@portalai/core/contracts";
import {
  HANDLE_ROW_CAP,
  TABLE_DISPLAY_ROW_LIMIT,
} from "@portalai/core/constants";

import { sdk } from "../../api/sdk";
import { useWidgetRefresh } from "../../utils/use-widget-refresh.util";

import type { BlockRef } from "@portalai/core";
import type { DataTableBlockContent } from "@portalai/core/contracts";

/** Snapshot page size for a handle-backed table — matches the prior QRDB. */
const SNAPSHOT_LIMIT = 5_000;

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface TableWidgetUIProps {
  columns: string[];
  rows: Record<string, unknown>[];
  /** Staged total for a handle-backed table — drives the row-cap notice. */
  rowCount?: number;
  /** `rowCount` is a lower bound (staging hit the cap) — render "N+". */
  truncated?: boolean;
  /** True total the query matched — the value to display (#340). */
  matchedCount?: number;
  /** Whether `matchedCount` is exact (#340). */
  matchedCountExact?: boolean;
  title?: string;
  /** Set by `visualize_d3`'s codegen-failure fallback. */
  message?: string;
  loading?: boolean;
  error?: string | null;
  lastUpdatedAt?: number | null;
  canRefresh?: boolean;
  isRefreshing?: boolean;
  notRefreshable?: boolean;
  /** The last refresh failed or was rate-limited (#349). */
  degraded?: boolean;
  onRefresh?: () => void;
}

export const TableWidgetUI: React.FC<TableWidgetUIProps> = ({
  columns,
  rows,
  rowCount = 0,
  truncated,
  matchedCount,
  matchedCountExact,
  title,
  message,
  loading = false,
  error = null,
  lastUpdatedAt = null,
  canRefresh = false,
  isRefreshing = false,
  notRefreshable = false,
  degraded = false,
  onRefresh,
}) => {
  // #340: display the TRUE matched total (falling back to rowCount for
  // pre-#340 blocks). "N+" only when it's a lower bound, not exact.
  const matched = matchedCount ?? rowCount;
  const exact = matchedCountExact ?? !truncated;
  const rowCountLabel = `${matched.toLocaleString()}${exact ? "" : "+"}`;

  const header = (
    <WidgetFreshnessBar
      title={title}
      lastUpdatedAt={lastUpdatedAt}
      isRefreshing={isRefreshing}
      canRefresh={canRefresh}
      notRefreshable={notRefreshable}
      degraded={degraded}
      status={isRefreshing ? "refreshing" : error ? "error" : "ready"}
      refreshLabel="Refresh table"
      onRefresh={onRefresh}
    />
  );

  if (error) {
    return (
      <>
        {header}
        <Box
          data-testid="table-widget-error"
          sx={{ p: 2, color: "error.main" }}
        >
          <Typography variant="body2">{error}</Typography>
        </Box>
      </>
    );
  }

  if (loading) {
    const willCap = matched > TABLE_DISPLAY_ROW_LIMIT;
    return (
      <>
        {header}
        <Box
          data-testid="table-widget-loading"
          sx={{ p: 2, display: "flex", alignItems: "center", gap: 1 }}
        >
          <CircularProgress size={16} />
          <Typography variant="caption" color="text.secondary">
            {/* Name what will actually render — this promised the full total
                and then listed a capped subset (#277). */}
            {willCap
              ? `Loading the first ${TABLE_DISPLAY_ROW_LIMIT.toLocaleString()} of ${rowCountLabel} rows…`
              : `Loading ${rowCountLabel} rows…`}
          </Typography>
        </Box>
      </>
    );
  }

  /**
   * Capped when fewer rows arrived than were staged. Derived from the rows
   * ACTUALLY received rather than compared against `TABLE_DISPLAY_ROW_LIMIT`:
   * the limit is also enforced server-side, and a message computed from an
   * assumed constant would silently become wrong if either side changed.
   */
  const shownCount = rows.length;
  const isCapped = shownCount > 0 && shownCount < matched;

  return (
    <>
      {header}
      {message ? (
        <Typography
          variant="caption"
          color="text.secondary"
          data-testid="table-widget-message"
          sx={{ display: "block", mb: 1 }}
        >
          {message}
        </Typography>
      ) : null}
      {isCapped ? (
        <Alert
          severity="info"
          data-testid="query-result-row-cap-notice"
          sx={{ mb: 1 }}
        >
          {/* Three load-bearing clauses (#277): the analysis was NOT capped;
              the table's own sort/search ARE (the top-N trap — ranking a
              truncated set yields a confidently wrong answer); and what to
              do instead. Each is asserted by its own test. */}
          <strong>
            Showing the first {shownCount.toLocaleString()} of {rowCountLabel}{" "}
            rows.
          </strong>{" "}
          {matched > HANDLE_ROW_CAP
            ? `Analysis ran on the first ${HANDLE_ROW_CAP.toLocaleString()}`
            : `All ${rowCountLabel} were analysed`}{" "}
          — but this table&apos;s sort and search only cover the{" "}
          {shownCount.toLocaleString()} shown, so they won&apos;t find or rank
          rows beyond them. To rank or filter across everything, ask for it in
          the query (e.g. &ldquo;top 20 by diameter&rdquo; or &ldquo;asteroids
          over 1&nbsp;km&rdquo;).
        </Alert>
      ) : null}
      {/*
        DataTableBlock DIRECTLY — never through ContentBlockRenderer. The
        renderer registry maps `data-table` to this very widget, so re-entering
        it (as the retired QueryResultDataBlock did) is infinite recursion.
      */}
      <DataTableBlock columns={columns} rows={rows} />
    </>
  );
};

// ── Container ──────────────────────────────────────────────────────────

export interface TableWidgetProps {
  /** A `data-table` block's content — inline rows or a handle envelope. */
  content: DataTableBlockContent | unknown;
  /** Persisted-block reference (#270/#312) — enables refresh. Absent for
   *  streaming/unpersisted blocks. */
  blockRef?: BlockRef;
  /** Epoch ms the block's data was persisted — seeds the freshness clock. */
  dataUpdatedAt?: number;
}

export const TableWidget: React.FC<TableWidgetProps> = ({
  content,
  blockRef,
  dataUpdatedAt,
}) => {
  const parsed = useMemo(
    () => DataTableBlockContentSchema.safeParse(content),
    [content]
  );
  // Parse failure is not fatal: fall back to reading the shape loosely so a
  // block minted by an older server still renders its rows.
  const raw = (content ?? {}) as {
    columns?: string[];
    rows?: Record<string, unknown>[];
    queryHandle?: string;
    rowCount?: number;
    truncated?: boolean;
    matchedCount?: number;
    matchedCountExact?: boolean;
    title?: string;
    message?: string;
  };
  const parsedContent = parsed.success ? (parsed.data as typeof raw) : raw;

  const {
    fresh,
    isRefreshing,
    error: refreshError,
    notRefreshable,
    lastUpdatedAt,
    refresh,
  } = useWidgetRefresh(blockRef, dataUpdatedAt);

  // A successful refresh's delivery overrides the persisted binding.
  const freshHandle = fresh?.kind === "handle" ? fresh : null;
  const freshInlineRows = fresh?.kind === "inline" ? fresh.rows : null;

  const baseHandle = parsedContent.queryHandle ?? null;
  const effectiveHandle = freshHandle
    ? freshHandle.queryHandle
    : freshInlineRows
      ? null
      : baseHandle;

  // Hooks can't be conditional, so the query is always constructed and gated
  // by `enabled` — an inline table never issues a request.
  const snapshot = sdk.portalSql.handleSnapshot(
    effectiveHandle ?? "",
    { offset: 0, limit: SNAPSHOT_LIMIT },
    { enabled: effectiveHandle != null }
  );

  const inlineRows =
    freshInlineRows ?? (fresh ? null : (parsedContent.rows ?? null));
  const rows = inlineRows ?? snapshot.data?.rows ?? [];

  const columns =
    parsedContent.columns ??
    (rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : []);

  const error = (() => {
    if (refreshError) return refreshError.message;
    if (!snapshot.error) return null;
    const code = (snapshot.error as { code?: string }).code;
    if (code === "READ_HANDLE_EXPIRED") {
      return "This table's data has expired from cache. Re-run the original query to refresh.";
    }
    return snapshot.error instanceof Error
      ? snapshot.error.message
      : "Unknown error";
  })();

  const hasData = rows.length > 0;

  return (
    <TableWidgetUI
      columns={columns}
      rows={rows}
      rowCount={freshHandle?.rowCount ?? parsedContent.rowCount}
      truncated={freshHandle?.truncated ?? parsedContent.truncated}
      matchedCount={freshHandle?.matchedCount ?? parsedContent.matchedCount}
      matchedCountExact={
        freshHandle?.matchedCountExact ?? parsedContent.matchedCountExact
      }
      title={parsedContent.title}
      message={parsedContent.message}
      loading={effectiveHandle != null && snapshot.isLoading}
      // A refresh failure with rows still on screen is reported by the cue,
      // not by replacing the table (#349).
      error={hasData ? null : error}
      lastUpdatedAt={lastUpdatedAt}
      canRefresh={blockRef != null && !notRefreshable}
      isRefreshing={isRefreshing}
      notRefreshable={notRefreshable}
      degraded={refreshError != null && hasData}
      onRefresh={refresh}
    />
  );
};

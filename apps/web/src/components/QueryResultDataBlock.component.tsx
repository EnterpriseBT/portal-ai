import React from "react";
import { Alert, Box, CircularProgress, Typography } from "@mui/material";

import { ContentBlockRenderer } from "@portalai/core";
import type { PortalMessageBlock } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";

// ── Types ──────────────────────────────────────────────────────────────

/**
 * Streaming render envelope used by `sql_query` (data table) when the row
 * count exceeds the inline threshold. The handle is fetched and the rows are
 * rendered through the core data-table block.
 */
export interface QueryResultDataBlockContent {
  queryHandle: string;
  rowCount: number;
  /** True when the staged result hit `HANDLE_ROW_CAP` — `rowCount` is then a
   *  lower bound, so the UI shows it as "N+" (#147). */
  truncated?: boolean;
  sampled?: boolean;
  samplePeek?: Array<Record<string, unknown>>;
  schema?: Array<{ name: string; type?: string }>;
}

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface QueryResultDataBlockUIProps {
  rowCount: number;
  /** `rowCount` is a lower bound (staging hit the cap) — render it as "N+". */
  truncated?: boolean;
  rows: Array<Record<string, unknown>>;
  loading: boolean;
  error: string | null;
}

/**
 * Rows the table lists at most (#277). The display is capped by design — a
 * listing of 10,000+ rows is unusable for a human, and the useful response to
 * an oversized result is to narrow the query.
 */
export const TABLE_DISPLAY_ROW_LIMIT = 5_000;

export const QueryResultDataBlockUI: React.FC<QueryResultDataBlockUIProps> = ({
  rowCount,
  truncated,
  rows,
  loading,
  error,
}) => {
  // "N+" when the true total is only a lower bound (#147).
  const rowCountLabel = `${rowCount.toLocaleString()}${truncated ? "+" : ""}`;
  /**
   * Capped when fewer rows arrived than were staged. Derived from the rows
   * ACTUALLY received rather than compared against `TABLE_DISPLAY_ROW_LIMIT`:
   * the limit is also enforced server-side (`portal-sql-handle.service.ts`
   * clamps every snapshot request), and a message computed from an assumed
   * constant would silently become wrong if either side changed.
   */
  const shownCount = rows.length;
  const isCapped = shownCount > 0 && shownCount < rowCount;
  const willCap = rowCount > TABLE_DISPLAY_ROW_LIMIT;
  if (error) {
    return (
      <Box
        data-testid="query-result-data-block-error"
        sx={{ p: 2, color: "error.main" }}
      >
        <Typography variant="body2">{error}</Typography>
      </Box>
    );
  }

  if (loading) {
    return (
      <Box
        data-testid="query-result-data-block-loading"
        sx={{
          p: 2,
          display: "flex",
          alignItems: "center",
          gap: 1,
        }}
      >
        <CircularProgress size={16} />
        <Typography variant="caption" color="text.secondary">
          {/* Name what will actually render — this promised the full total and
              then listed a capped subset (#277). */}
          {willCap
            ? `Loading the first ${TABLE_DISPLAY_ROW_LIMIT.toLocaleString()} of ${rowCountLabel} rows…`
            : `Loading ${rowCountLabel} rows…`}
        </Typography>
      </Box>
    );
  }

  // Tabular path (sql_query handle): render the rows through the core
  // data-table block so the user gets the same look as inline results.
  const columns =
    rows.length > 0 ? Object.keys(rows[0] as Record<string, unknown>) : [];
  const block: PortalMessageBlock = {
    type: "data-table",
    content: { columns, rows },
  };
  return (
    <>
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
          All {rowCountLabel} were analysed — but this table&apos;s sort and
          search only cover the {shownCount.toLocaleString()} shown, so they
          won&apos;t find or rank rows beyond them. To rank or filter across
          everything, ask for it in the query (e.g. &ldquo;top 20 by
          diameter&rdquo; or &ldquo;asteroids over 1&nbsp;km&rdquo;).
        </Alert>
      ) : null}
      <ContentBlockRenderer block={block} />
    </>
  );
};

// ── Container ──────────────────────────────────────────────────────────

export interface QueryResultDataBlockProps {
  content: QueryResultDataBlockContent;
}

export const QueryResultDataBlock: React.FC<QueryResultDataBlockProps> = ({
  content,
}) => {
  // Snapshot first — gives us the full dataset for the chart's
  // initial render. Slice-level live SSE streaming is a Phase 3
  // polish follow-up; the snapshot is canonical anyway.
  const query = sdk.portalSql.handleSnapshot(content.queryHandle, {
    offset: 0,
    limit: 5_000,
  });

  const rows = query.data?.rows ?? [];
  const error = (() => {
    if (!query.error) return null;
    const code = (query.error as { code?: string }).code;
    if (code === "READ_HANDLE_EXPIRED") {
      return "The chart's data has expired from cache. Re-run the original query to refresh.";
    }
    return query.error instanceof Error ? query.error.message : "Unknown error";
  })();

  return (
    <QueryResultDataBlockUI
      rowCount={content.rowCount}
      truncated={content.truncated}
      rows={rows}
      loading={query.isLoading}
      error={error}
    />
  );
};

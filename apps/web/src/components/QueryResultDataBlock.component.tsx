import React from "react";
import { Box, CircularProgress, Typography } from "@mui/material";

import { ContentBlockRenderer } from "@portalai/core";
import type { PortalMessageBlock } from "@portalai/core/contracts";

import { sdk } from "../api/sdk";

// ── Types ──────────────────────────────────────────────────────────────

/**
 * A vega-lite tool result returns this shape when the row count exceeds
 * INLINE_ROWS_THRESHOLD (per Phase 3 slice 3 in api/tools/visualize):
 *   { type, queryHandle, rowCount, schema, sampled, samplePeek, spec }
 *
 * The spec was rewritten server-side: `data: { name: "primary" }` (the
 * named dataset).
 */
export interface QueryResultDataBlockContent {
  queryHandle: string;
  rowCount: number;
  sampled?: boolean;
  samplePeek?: Array<Record<string, unknown>>;
  spec: Record<string, unknown>;
}

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface QueryResultDataBlockUIProps {
  rowCount: number;
  rows: Array<Record<string, unknown>>;
  spec: Record<string, unknown>;
  loading: boolean;
  error: string | null;
}

export const QueryResultDataBlockUI: React.FC<
  QueryResultDataBlockUIProps
> = ({ rowCount, rows, spec, loading, error }) => {
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
          Loading {rowCount.toLocaleString()} rows…
        </Typography>
      </Box>
    );
  }

  // Substitute the rows directly into the spec under
  // `datasets.primary` — same shape Vega-Lite consumes when a named
  // dataset is declared via `data: { name: "primary" }`. Renders via
  // the existing core ContentBlockRenderer's vega-lite branch.
  const specWithData = {
    ...spec,
    datasets: { ...(spec.datasets as object | undefined), primary: rows },
  };
  const block: PortalMessageBlock = {
    type: "vega-lite",
    content: specWithData,
  };
  return <ContentBlockRenderer block={block} />;
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
    return query.error instanceof Error
      ? query.error.message
      : "Unknown error";
  })();

  return (
    <QueryResultDataBlockUI
      rowCount={content.rowCount}
      rows={rows}
      spec={content.spec}
      loading={query.isLoading}
      error={error}
    />
  );
};

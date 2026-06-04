import React, { useEffect, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";

import { ContentBlockRenderer } from "@portalai/core";
import type { PortalMessageBlock } from "@portalai/core/contracts";

import { useAuthFetch } from "../utils/api.util";

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

interface SnapshotPayload {
  rows: Array<Record<string, unknown>>;
  total: number;
  offset: number;
  limit: number;
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
  const { fetchWithAuth } = useAuthFetch();
  const [rows, setRows] = useState<Array<Record<string, unknown>>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        setLoading(true);
        // Snapshot first — gives us the full dataset for the chart's
        // initial render. Slice-level live SSE streaming is a Phase 3
        // polish follow-up; the snapshot is canonical anyway.
        const body = await fetchWithAuth<{
          success: true;
          payload: SnapshotPayload;
        }>(
          `/api/portal-sql/handle/${encodeURIComponent(
            content.queryHandle
          )}?offset=0&limit=5000`
        );
        if (cancelled) return;
        setRows(body.payload.rows);
      } catch (err) {
        if (cancelled) return;
        // fetchWithAuth throws ApiError on non-OK; READ_HANDLE_EXPIRED
        // surfaces a friendlier message.
        const code = (err as { code?: string }).code;
        if (code === "READ_HANDLE_EXPIRED") {
          setError(
            "The chart's data has expired from cache. Re-run the original query to refresh."
          );
        } else {
          setError(err instanceof Error ? err.message : "Unknown error");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [content.queryHandle, fetchWithAuth]);

  return (
    <QueryResultDataBlockUI
      rowCount={content.rowCount}
      rows={rows}
      spec={content.spec}
      loading={loading}
      error={error}
    />
  );
};

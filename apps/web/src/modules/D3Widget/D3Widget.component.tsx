import React, { useMemo, useState } from "react";
import {
  Box,
  Chip,
  CircularProgress,
  IconButton,
  Paper,
  Tooltip,
  Typography,
} from "@mui/material";
import RefreshIcon from "@mui/icons-material/Refresh";
import { useTheme } from "@mui/material/styles";

import { D3BlockContentSchema } from "@portalai/core/contracts";
import { DateFactory } from "@portalai/core/utils";

import { D3SandboxFrameUI } from "./D3SandboxFrame.component";
import { useProgressiveHandleRows } from "./utils/progressive-rows.util";
import {
  useWidgetRefresh,
  type WidgetRef,
} from "./utils/use-widget-refresh.util";
import { buildSandboxTheme } from "./utils/sandbox-theme.util";

import type { D3BlockContent } from "@portalai/core/contracts";
import type { ProgressiveBatch } from "./utils/progressive-rows.util";
import type { D3SandboxTheme } from "./utils/sandbox-theme.util";

// Chart area bounded to the chat column, matching the core renderers'
// CHART_BOUNDS convention (#145).
const CHART_BOUNDS: React.CSSProperties = {
  width: "100%",
  maxWidth: "100%",
  overflowX: "auto",
};

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface D3WidgetUIProps {
  program: string;
  title?: string;
  params?: Record<string, unknown>;
  theme: D3SandboxTheme;
  batches: ProgressiveBatch[];
  /** Envelope rowCount for handle blocks; rows.length for inline. */
  totalRows: number;
  /** `totalRows` is a lower bound (staging hit the cap) — render "N+". */
  truncated?: boolean;
  receivedRows: number;
  complete: boolean;
  loading: boolean;
  /** Fetch or sandbox error — replaces the chart area. */
  error: string | null;
  onFrameError: (event: { message: string }) => void;
  /** Last rendered content height, forwarded from the sandbox frame (#271) —
   *  the gate reuses it to size a torn-down widget's placeholder. */
  onHeight?: (height: number) => void;
  // ── refresh affordance (#270) ──
  /** Show the always-present manual refresh control (persisted widgets). */
  canRefresh?: boolean;
  isRefreshing?: boolean;
  onRefresh?: () => void;
  /** Epoch ms of the last hydration — drives the "Updated ⟨time⟩ ago" cue. */
  lastUpdatedAt?: number | null;
  /** The widget predates durable pipelines — show a re-run note, no button. */
  notRefreshable?: boolean;
  /** Render/data status shown as a chip in the frame (#271). `ready` shows no
   *  chip (the chart speaks for itself); the rest surface attention states. */
  status?: "loading" | "rendering" | "ready" | "error" | "refreshing" | "stale";
}

/** Status chip label + MUI color. `ready` → no chip. */
const STATUS_CHIP: Record<
  Exclude<NonNullable<D3WidgetUIProps["status"]>, "ready">,
  { label: string; color: "default" | "info" | "warning" | "error" }
> = {
  loading: { label: "Loading", color: "default" },
  rendering: { label: "Rendering", color: "info" },
  refreshing: { label: "Refreshing", color: "info" },
  stale: { label: "Stale", color: "warning" },
  error: { label: "Error", color: "error" },
};

export const D3WidgetUI: React.FC<D3WidgetUIProps> = ({
  program,
  title,
  params,
  theme,
  batches,
  totalRows,
  truncated,
  receivedRows,
  complete,
  loading,
  error,
  onFrameError,
  onHeight,
  canRefresh = false,
  isRefreshing = false,
  onRefresh,
  lastUpdatedAt = null,
  notRefreshable = false,
  status = "ready",
}) => {
  const totalLabel = `${totalRows.toLocaleString()}${truncated ? "+" : ""}`;
  const chip = status !== "ready" ? STATUS_CHIP[status] : null;

  const header =
    title || canRefresh || lastUpdatedAt != null || chip ? (
      <Box
        sx={{ display: "flex", alignItems: "center", gap: 1, mb: 0.5 }}
        data-testid="d3-widget-header"
      >
        {title ? (
          <Typography variant="subtitle2" sx={{ flex: 1, minWidth: 0 }}>
            {title}
          </Typography>
        ) : (
          <Box sx={{ flex: 1, minWidth: 0 }} />
        )}
        {chip ? (
          <Chip
            size="small"
            variant="outlined"
            color={chip.color}
            label={chip.label}
            data-testid="d3-widget-status"
          />
        ) : null}
        {lastUpdatedAt != null ? (
          <Typography
            variant="caption"
            color="text.secondary"
            data-testid="d3-widget-updated"
          >
            Updated {DateFactory.relativeTime(lastUpdatedAt)}
          </Typography>
        ) : null}
        {canRefresh ? (
          <Tooltip title="Refresh chart">
            <span>
              <IconButton
                size="small"
                aria-label="Refresh chart"
                disabled={isRefreshing}
                onClick={onRefresh}
                sx={{ flexShrink: 0 }}
              >
                {isRefreshing ? (
                  <CircularProgress size={14} />
                ) : (
                  <RefreshIcon fontSize="small" />
                )}
              </IconButton>
            </span>
          </Tooltip>
        ) : null}
      </Box>
    ) : null;

  const note = notRefreshable ? (
    <Typography
      variant="caption"
      color="text.secondary"
      data-testid="d3-widget-not-refreshable"
    >
      This chart can&rsquo;t auto-refresh — re-run the prompt for live data.
    </Typography>
  ) : null;

  let body: React.ReactNode;
  if (error) {
    body = (
      <Box
        data-testid="d3-widget-error"
        sx={{ p: 2, color: "error.main", fontFamily: "monospace" }}
      >
        <Typography variant="body2" component="span">
          Visualization failed to render: {error}
        </Typography>
      </Box>
    );
  } else if (loading) {
    body = (
      <Box
        data-testid="d3-widget-loading"
        sx={{ p: 2, display: "flex", alignItems: "center", gap: 1 }}
      >
        <CircularProgress size={16} />
        <Typography variant="caption" color="text.secondary">
          Loading {totalLabel} rows…
        </Typography>
      </Box>
    );
  } else {
    body = (
      <>
        <div style={CHART_BOUNDS}>
          <D3SandboxFrameUI
            program={program}
            params={params}
            theme={theme}
            batches={batches}
            onRendered={(event) => onHeight?.(event.height)}
            onError={onFrameError}
          />
        </div>
        {!complete ? (
          <Typography variant="caption" color="text.secondary">
            Rendering {receivedRows.toLocaleString()} of {totalLabel} rows…
          </Typography>
        ) : null}
      </>
    );
  }

  return (
    <Paper variant="outlined" data-testid="d3-widget" sx={{ p: 1.5 }}>
      {header}
      {note}
      {body}
    </Paper>
  );
};

// ── Container ──────────────────────────────────────────────────────────

export interface D3WidgetProps {
  /** A `d3` block's content — validated against `D3BlockContentSchema`. */
  content: D3BlockContent | unknown;
  /** Persisted-block reference (#270) — enables refresh. Absent for
   *  streaming/unpersisted blocks. */
  blockRef?: WidgetRef;
  /** Epoch ms the block's data was persisted (the message's `created`) —
   *  seeds the freshness clock so a just-minted widget isn't auto-refreshed. */
  dataUpdatedAt?: number;
  /** Forwarded rendered height (#271) — the gate reuses it to size the
   *  placeholder when the widget is torn down offscreen. */
  onHeight?: (height: number) => void;
}

export const D3Widget: React.FC<D3WidgetProps> = ({
  content,
  blockRef,
  dataUpdatedAt,
  onHeight,
}) => {
  const muiTheme = useTheme();
  const sandboxTheme = useMemo(() => buildSandboxTheme(muiTheme), [muiTheme]);
  const [frameError, setFrameError] = useState<string | null>(null);

  const parsed = useMemo(
    () => D3BlockContentSchema.safeParse(content),
    [content]
  );
  const parsedContent = parsed.success ? parsed.data : null;

  const {
    fresh,
    isRefreshing,
    error: refreshError,
    notRefreshable,
    lastUpdatedAt,
    refresh,
  } = useWidgetRefresh(blockRef, dataUpdatedAt);

  // A successful refresh's delivery overrides the persisted data binding;
  // program/title/params always come from the block itself.
  const freshHandle = fresh?.kind === "handle" ? fresh : null;
  const freshInlineRows = fresh?.kind === "inline" ? fresh.rows : null;

  const baseHandle =
    parsedContent && "queryHandle" in parsedContent ? parsedContent : null;
  const baseInlineRows =
    parsedContent && "rows" in parsedContent ? parsedContent.rows : null;

  const effectiveHandle = freshHandle
    ? freshHandle.queryHandle
    : freshInlineRows
      ? null
      : (baseHandle?.queryHandle ?? null);

  const progressive = useProgressiveHandleRows(effectiveHandle);

  const inlineRows = freshInlineRows ?? (fresh ? null : baseInlineRows);
  const inlineBatches = useMemo<ProgressiveBatch[]>(
    () => (inlineRows ? [{ rows: inlineRows, seq: 0, done: true }] : []),
    [inlineRows]
  );

  if (!parsedContent) {
    return (
      <D3WidgetUI
        program=""
        theme={sandboxTheme}
        batches={[]}
        totalRows={0}
        receivedRows={0}
        complete={false}
        loading={false}
        error="Invalid d3 block content."
        onFrameError={() => {}}
      />
    );
  }

  const isHandle = effectiveHandle !== null;
  const batches = isHandle ? progressive.batches : inlineBatches;
  const fetchError = isHandle ? progressive.error : null;
  const hasData = batches.length > 0;

  const totalRows = freshHandle
    ? freshHandle.rowCount
    : freshInlineRows
      ? freshInlineRows.length
      : baseHandle
        ? baseHandle.rowCount
        : (baseInlineRows?.length ?? 0);
  const truncated = freshHandle
    ? freshHandle.truncated
    : fresh
      ? false
      : (baseHandle?.truncated ?? false);

  // While a refresh is in flight with nothing rendered yet, show loading (not
  // the possibly-expired original handle's error) — the fresh handle swaps in
  // when it arrives. A prior render is kept until the swap succeeds.
  const loading = !hasData && (isRefreshing || (!fetchError && !frameError));
  const error = hasData
    ? frameError
    : isRefreshing
      ? null
      : (refreshError?.message ?? fetchError ?? frameError);
  const complete = isHandle ? progressive.complete : true;

  // Frame status (#271): refresh in flight > error > pre-first-batch load >
  // still-streaming rows > ready.
  const status: NonNullable<D3WidgetUIProps["status"]> = isRefreshing
    ? "refreshing"
    : error
      ? "error"
      : loading
        ? "loading"
        : !complete
          ? "rendering"
          : "ready";

  return (
    <D3WidgetUI
      program={parsedContent.program}
      title={parsedContent.title}
      params={parsedContent.params}
      theme={sandboxTheme}
      batches={batches}
      totalRows={totalRows}
      truncated={truncated}
      receivedRows={
        isHandle ? progressive.receivedRows : (batches[0]?.rows.length ?? 0)
      }
      complete={complete}
      loading={loading}
      error={error}
      onFrameError={(event) => setFrameError(event.message)}
      onHeight={onHeight}
      canRefresh={blockRef != null && !notRefreshable}
      isRefreshing={isRefreshing}
      onRefresh={refresh}
      lastUpdatedAt={lastUpdatedAt}
      notRefreshable={notRefreshable}
      status={status}
    />
  );
};

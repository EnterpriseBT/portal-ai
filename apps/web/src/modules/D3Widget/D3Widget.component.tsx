import React, { useMemo, useState } from "react";
import { Box, CircularProgress, Typography } from "@mui/material";
import { useTheme } from "@mui/material/styles";

import { D3BlockContentSchema } from "@portalai/core/contracts";

import { D3SandboxFrameUI } from "./D3SandboxFrame.component";
import { useProgressiveHandleRows } from "./utils/progressive-rows.util";
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
}

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
}) => {
  const totalLabel = `${totalRows.toLocaleString()}${truncated ? "+" : ""}`;

  if (error) {
    return (
      <Box
        data-testid="d3-widget-error"
        sx={{ p: 2, color: "error.main", fontFamily: "monospace" }}
      >
        <Typography variant="body2" component="span">
          Visualization failed to render: {error}
        </Typography>
      </Box>
    );
  }

  if (loading) {
    return (
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
  }

  return (
    <Box data-testid="d3-widget">
      {title ? (
        <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
          {title}
        </Typography>
      ) : null}
      <div style={CHART_BOUNDS}>
        <D3SandboxFrameUI
          program={program}
          params={params}
          theme={theme}
          batches={batches}
          onError={onFrameError}
        />
      </div>
      {!complete ? (
        <Typography variant="caption" color="text.secondary">
          Rendering {receivedRows.toLocaleString()} of {totalLabel} rows…
        </Typography>
      ) : null}
    </Box>
  );
};

// ── Container ──────────────────────────────────────────────────────────

export interface D3WidgetProps {
  /** A `d3` block's content — validated against `D3BlockContentSchema`. */
  content: D3BlockContent | unknown;
}

export const D3Widget: React.FC<D3WidgetProps> = ({ content }) => {
  const muiTheme = useTheme();
  const sandboxTheme = useMemo(() => buildSandboxTheme(muiTheme), [muiTheme]);
  const [frameError, setFrameError] = useState<string | null>(null);

  const parsed = useMemo(
    () => D3BlockContentSchema.safeParse(content),
    [content]
  );
  const parsedContent = parsed.success ? parsed.data : null;
  const handleContent =
    parsedContent && "queryHandle" in parsedContent ? parsedContent : null;
  const inlineContent =
    parsedContent && "rows" in parsedContent ? parsedContent : null;

  const progressive = useProgressiveHandleRows(
    handleContent?.queryHandle ?? null
  );

  const inlineBatches = useMemo<ProgressiveBatch[]>(
    () =>
      inlineContent ? [{ rows: inlineContent.rows, seq: 0, done: true }] : [],
    [inlineContent]
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

  const isHandle = handleContent !== null;
  const batches = isHandle ? progressive.batches : inlineBatches;
  const fetchError = isHandle ? progressive.error : null;

  return (
    <D3WidgetUI
      program={parsedContent.program}
      title={parsedContent.title}
      params={parsedContent.params}
      theme={sandboxTheme}
      batches={batches}
      totalRows={
        isHandle ? handleContent.rowCount : inlineBatches[0].rows.length
      }
      truncated={isHandle ? handleContent.truncated : false}
      receivedRows={
        isHandle ? progressive.receivedRows : inlineBatches[0].rows.length
      }
      complete={isHandle ? progressive.complete : true}
      loading={batches.length === 0 && !fetchError && !frameError}
      error={fetchError ?? frameError}
      onFrameError={(event) => setFrameError(event.message)}
    />
  );
};

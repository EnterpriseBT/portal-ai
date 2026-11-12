import React, { useId, useState } from "react";
import { Box, Button, Paper, Typography } from "@mui/material";

// ── UI (pure) ──────────────────────────────────────────────────────────

export interface VisualFigureUIProps {
  kind: "chart" | "map";
  title?: string;
  /** Already resolved through `visualSummary` (#796): the agent's text, or
   *  the derived fallback. Shown under the header and read as the figure's
   *  description. */
  summary: string;
  /** The widget's freshness bar. */
  header: React.ReactNode;
  /** The chart or map body. */
  children: React.ReactNode;
  /** The data alternative. Omitted → no Data button. */
  data?: React.ReactNode;
  /** Kept as the widget's own test id ("d3-widget" / "map-widget"). */
  testId: string;
}

/**
 * The accessible shell every chart and map renders in (#796): a figure named
 * by its title and described by a visible summary, with its data behind a
 * disclosure so a reader who can't see the drawing can still read it.
 */
export const VisualFigureUI: React.FC<VisualFigureUIProps> = ({
  kind,
  title,
  summary,
  header,
  children,
  data,
  testId,
}) => {
  const summaryId = useId();
  const regionId = useId();
  const [dataOpen, setDataOpen] = useState(false);
  const name = title?.trim() || (kind === "chart" ? "Chart" : "Map");

  return (
    <Paper
      variant="outlined"
      role="figure"
      aria-label={name}
      aria-describedby={summaryId}
      data-testid={testId}
      // Styled from the theme (#796): `[data-visual-part="figure"]`.
      data-visual-part="figure"
    >
      {header}
      <Typography
        id={summaryId}
        variant="body2"
        color="text.secondary"
        data-testid={`${testId}-summary`}
      >
        {summary}
      </Typography>
      {children}
      {data ? (
        <Box>
          <Button
            size="small"
            aria-expanded={dataOpen}
            aria-controls={dataOpen ? regionId : undefined}
            onClick={() => setDataOpen((open) => !open)}
          >
            {dataOpen ? "Hide data" : "Show data"}
          </Button>
          {dataOpen ? (
            <Box id={regionId} role="region" aria-label={`Data for ${name}`}>
              {data}
            </Box>
          ) : null}
        </Box>
      ) : null}
    </Paper>
  );
};

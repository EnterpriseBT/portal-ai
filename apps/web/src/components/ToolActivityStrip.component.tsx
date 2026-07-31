import React from "react";

import CircularProgress from "@mui/material/CircularProgress";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";

export interface ToolActivityStripUIProps {
  /** Phase of the running tool, e.g. "Building the chart". */
  label: string;
  /** Whole seconds on the active step. */
  elapsedSeconds: number;
}

/**
 * Pinned counterpart to the inline typing indicator (#279): names the running
 * tool and how long it has been going, so the state stays visible when the
 * user has scrolled away from the bottom of the feed.
 *
 * **This component owns no positioning.** It is a partial-width pill; the
 * overlay placement above the composer belongs to `ChatWindowUI`'s
 * `statusStrip` slot. That split is deliberate — the strip must never
 * participate in layout, because a row that appears mid-turn would move the
 * text input under a typing user and re-measure the feed's scroll viewport.
 */
export const ToolActivityStrip: React.FC<ToolActivityStripUIProps> = ({
  label,
  elapsedSeconds,
}) => (
  <Paper
    elevation={3}
    role="status"
    aria-label={label}
    data-testid="tool-activity-strip"
    sx={{
      display: "inline-flex",
      alignItems: "center",
      gap: 1,
      px: 1.5,
      py: 0.75,
      borderRadius: 5,
      bgcolor: "background.paper",
      // The overlay sits over feed content; keep clicks and text selection
      // going to the messages underneath.
      pointerEvents: "none",
      maxWidth: "100%",
    }}
  >
    <CircularProgress size={14} thickness={5} />
    <Typography variant="body2" color="text.secondary" noWrap>
      {label}
    </Typography>
    <Typography
      component="span"
      variant="caption"
      color="text.disabled"
      aria-hidden="true"
      data-testid="tool-activity-strip-elapsed"
    >
      {elapsedSeconds}s
    </Typography>
  </Paper>
);

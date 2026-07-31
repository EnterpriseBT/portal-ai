import React from "react";

import Box from "@mui/material/Box";
import Paper from "@mui/material/Paper";
import Typography from "@mui/material/Typography";
import { keyframes } from "@mui/material/styles";

interface TypingIndicatorUIProps {
  ariaLabel?: string;
  /**
   * Phase of the running tool (#279), e.g. "Building the chart". When absent
   * the indicator is the plain three dots it has always been.
   */
  label?: string;
  /** Whole seconds on the active step, rendered as "18s" beside the label. */
  elapsedSeconds?: number;
}

const blink = keyframes`
  0%, 80%, 100% { opacity: 0.2; }
  40% { opacity: 1; }
`;

/**
 * Animated three-dot indicator shown in the portal chat between when
 * the user sends a message and the assistant's first streamed block
 * arrives. Rendered as a left-aligned chat bubble (mirrors the
 * right-aligned `Paper elevation={1}` user bubble in
 * `PortalMessage.component.tsx`) so it reads as "the assistant is
 * typing".
 *
 * With a `label` (#279) it stays mounted for the whole turn and names the
 * running tool plus how long it has been going, because a tool turn's first
 * delta is usually a one-line preamble — after which the dots would vanish
 * and the feed would sit frozen until the finished block arrives.
 */
export const TypingIndicator: React.FC<TypingIndicatorUIProps> = ({
  ariaLabel = "Assistant is typing",
  label,
  elapsedSeconds,
}) => (
  <Box sx={{ display: "flex", justifyContent: "flex-start", mb: 1 }}>
    <Paper
      elevation={1}
      role="status"
      // Announce the phase when there is one — "Building the chart" is the
      // useful thing to hear, not "Assistant is typing".
      aria-label={label ?? ariaLabel}
      data-testid="typing-indicator"
      sx={{
        px: 1.5,
        py: 1.25,
        borderRadius: 4,
        bgcolor: "action.hover",
        display: "inline-flex",
        alignItems: "center",
        gap: 0.75,
      }}
    >
      {[0, 1, 2].map((i) => (
        <Box
          key={i}
          sx={{
            width: 6,
            height: 6,
            borderRadius: "50%",
            bgcolor: "text.secondary",
            animation: `${blink} 1.2s infinite ease-in-out`,
            animationDelay: `${i * 0.2}s`,
          }}
        />
      ))}
      {label && (
        <Typography variant="body2" color="text.secondary" sx={{ ml: 0.5 }}>
          {label}
        </Typography>
      )}
      {label && typeof elapsedSeconds === "number" && (
        <Typography
          component="span"
          variant="caption"
          color="text.disabled"
          // The counter re-renders every second; inside this role="status"
          // live region that would announce continuously.
          aria-hidden="true"
          data-testid="typing-indicator-elapsed"
        >
          {elapsedSeconds}s
        </Typography>
      )}
    </Paper>
  </Box>
);

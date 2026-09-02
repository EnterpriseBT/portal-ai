import React from "react";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";

export interface ProgressProps {
  /** Current progress value (0–100). */
  value: number;
  /** Whether to show the percentage label. Defaults to true. */
  showLabel?: boolean;
  /**
   * MUI color for the progress bar. `inherit` takes the surrounding text
   * color for the bar, track, and percent label — the right choice inside
   * filled surfaces (e.g. a filled Alert toast), where the palette colors
   * and `text.secondary` both lack contrast against the fill (#458).
   */
  color?:
    | "primary"
    | "secondary"
    | "success"
    | "error"
    | "warning"
    | "info"
    | "inherit";
  /** Height of the progress bar in pixels. */
  height?: number;
  /** Whether to show a pulsing glow animation to indicate active processing. */
  animated?: boolean;
  /**
   * Render MUI's indeterminate variant — for work whose extent is genuinely
   * unknown (#458). `value` is ignored and the percent label is suppressed
   * (an indeterminate bar has no honest number to print).
   */
  indeterminate?: boolean;
  className?: string;
  [key: `data-${string}`]: string;
}

export const Progress = React.forwardRef<HTMLDivElement, ProgressProps>(
  (
    {
      value,
      showLabel = true,
      color = "primary",
      height = 8,
      animated = false,
      indeterminate = false,
      className,
      ...rest
    },
    ref
  ) => {
    const clampedValue = Math.min(100, Math.max(0, value));

    return (
      <Box
        ref={ref}
        display="flex"
        alignItems="center"
        gap={1.5}
        className={className}
        {...rest}
      >
        <Box sx={{ flex: 1 }}>
          <LinearProgress
            variant={indeterminate ? "indeterminate" : "determinate"}
            {...(indeterminate ? {} : { value: clampedValue })}
            color={color}
            sx={(theme) => {
              // No palette entry exists for `inherit`; the shadow pulse is
              // skipped there (the bar's own pulseGlow still runs).
              const glow =
                color === "inherit" ? null : theme.palette[color].main;
              return {
                height,
                borderRadius: height / 2,
                // Inherit mode runs on filled surfaces. MUI's colorInherit
                // track is currentColor at 30% opacity — white-on-white next
                // to the white bar. Replace it with a translucent black
                // track, which darkens whatever fill is behind it, so bar
                // (currentColor) vs track read unambiguously.
                ...(color === "inherit" && {
                  backgroundColor: "rgba(0, 0, 0, 0.25)",
                  "&::before": { display: "none" },
                }),
                ...(animated &&
                  glow && {
                    "@keyframes barShadowPulse": {
                      "0%, 100%": {
                        boxShadow: `0 0 ${height / 4}px 0px ${glow}33`,
                      },
                      "50%": {
                        boxShadow: `0 0 ${height / 2}px 1px ${glow}55`,
                      },
                    },
                    animation: "barShadowPulse 2s ease-in-out infinite",
                  }),
                ...(animated && {
                  "& .MuiLinearProgress-bar": {
                    "@keyframes pulseGlow": {
                      "0%, 100%": { opacity: 1, filter: "brightness(1)" },
                      "50%": { opacity: 0.92, filter: "brightness(1.15)" },
                    },
                    animation: "pulseGlow 2s ease-in-out infinite",
                  },
                }),
              };
            }}
          />
        </Box>
        {showLabel && !indeterminate && (
          <Typography
            variant="body2"
            color={color === "inherit" ? "inherit" : "text.secondary"}
            sx={{ minWidth: 40, textAlign: "right" }}
          >
            {Math.round(clampedValue)}%
          </Typography>
        )}
      </Box>
    );
  }
);

export default Progress;

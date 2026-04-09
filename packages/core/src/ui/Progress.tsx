import React from "react";
import Box from "@mui/material/Box";
import LinearProgress from "@mui/material/LinearProgress";
import Typography from "@mui/material/Typography";

export interface ProgressProps {
  /** Current progress value (0–100). */
  value: number;
  /** Whether to show the percentage label. Defaults to true. */
  showLabel?: boolean;
  /** MUI color for the progress bar. */
  color?: "primary" | "secondary" | "success" | "error" | "warning" | "info";
  /** Height of the progress bar in pixels. */
  height?: number;
  /** Whether to show a pulsing glow animation to indicate active processing. */
  animated?: boolean;
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
            variant="determinate"
            value={clampedValue}
            color={color}
            sx={(theme) => ({
              height,
              borderRadius: height / 2,
              ...(animated && {
                "@keyframes barShadowPulse": {
                  "0%, 100%": {
                    boxShadow: `0 0 ${height / 4}px 0px ${theme.palette[color].main}33`,
                  },
                  "50%": {
                    boxShadow: `0 0 ${height / 2}px 1px ${theme.palette[color].main}55`,
                  },
                },
                animation: "barShadowPulse 2s ease-in-out infinite",
                "& .MuiLinearProgress-bar": {
                  "@keyframes pulseGlow": {
                    "0%, 100%": { opacity: 1, filter: "brightness(1)" },
                    "50%": { opacity: 0.92, filter: "brightness(1.15)" },
                  },
                  animation: "pulseGlow 2s ease-in-out infinite",
                },
              }),
            })}
          />
        </Box>
        {showLabel && (
          <Typography
            variant="body2"
            color="text.secondary"
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

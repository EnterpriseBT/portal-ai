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
            sx={{
              height,
              borderRadius: height / 2,
              ...(animated && {
                "& .MuiLinearProgress-bar": {
                  "@keyframes pulseGlow": {
                    "0%, 100%": { opacity: 1, filter: "brightness(1)" },
                    "50%": { opacity: 0.85, filter: "brightness(1.35)" },
                  },
                  animation: "pulseGlow 1s ease-in-out infinite",
                },
              }),
            }}
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

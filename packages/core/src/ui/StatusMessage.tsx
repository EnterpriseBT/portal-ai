import React from "react";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import { Icon, IconName } from "./Icon.js";
import { visuallyHidden } from "./visually-hidden.js";

export type StatusMessageVariant = "error" | "warning" | "info" | "success";

export interface StatusMessageProps {
  message?: string;
  variant?: StatusMessageVariant;
  error?: Error | null;
  loading?: boolean;
  tooltip?: string;
  className?: string;
  /**
   * Screen-reader only (#794): just the live element and its text. Mount it
   * for the owner's lifetime and change `message`; a region that arrives
   * already holding its text may not be read.
   */
  visuallyHidden?: boolean;
  [key: `data-${string}`]: string;
}

const variantIconMap: Record<StatusMessageVariant, IconName> = {
  error: IconName.Error,
  warning: IconName.Warning,
  info: IconName.Info,
  success: IconName.CheckCircle,
};

const variantColorMap: Record<StatusMessageVariant, string> = {
  error: "error.main",
  warning: "warning.main",
  info: "info.main",
  success: "success.main",
};

export const StatusMessage = React.forwardRef<
  HTMLDivElement,
  StatusMessageProps
>(
  (
    {
      message,
      variant = "info",
      error,
      loading = false,
      tooltip,
      className,
      visuallyHidden: hidden = false,
      ...rest
    },
    ref
  ) => {
    const displayMessage = message || error?.message;
    const role = variant === "error" && !loading ? "alert" : "status";

    if (hidden) {
      return (
        <div
          ref={ref}
          className={className}
          role={role}
          style={visuallyHidden}
          {...rest}
        >
          {displayMessage}
        </div>
      );
    }
    const color = variantColorMap[variant];

    const content = (
      <Stack
        ref={ref}
        direction="row"
        justifyContent="center"
        alignItems="center"
        gap={1}
        className={className}
        // An error interrupts; anything else (loading included) waits its
        // turn (WCAG 4.1.3, #797).
        role={role}
        {...rest}
      >
        {loading ? (
          <CircularProgress
            size={20}
            aria-label={displayMessage || "Loading"}
          />
        ) : (
          <Icon
            name={variantIconMap[variant]}
            sx={{ color }}
            fontSize="small"
          />
        )}
        {displayMessage && (
          <Typography variant="body2" sx={{ color }}>
            {displayMessage}
          </Typography>
        )}
      </Stack>
    );

    if (tooltip) {
      return <Tooltip title={tooltip}>{content}</Tooltip>;
    }

    return content;
  }
);

export default StatusMessage;

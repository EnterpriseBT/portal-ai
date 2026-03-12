import React from "react";
import Stack from "@mui/material/Stack";
import CircularProgress from "@mui/material/CircularProgress";
import Typography from "@mui/material/Typography";
import Tooltip from "@mui/material/Tooltip";
import { Icon, IconName } from "./Icon.js";

export type StatusMessageVariant = "error" | "warning" | "info" | "success";

export interface StatusMessageProps {
  message?: string;
  variant?: StatusMessageVariant;
  error?: Error | null;
  loading?: boolean;
  tooltip?: string;
  className?: string;
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
      ...rest
    },
    ref
  ) => {
    const displayMessage = message || error?.message;
    const color = variantColorMap[variant];

    const content = (
      <Stack
        ref={ref}
        direction="row"
        justifyContent="center"
        alignItems="center"
        gap={1}
        className={className}
        {...rest}
      >
        {loading ? (
          <CircularProgress size={20} />
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

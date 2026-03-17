import React from "react";
import Chip from "@mui/material/Chip";
import type { ChipProps } from "@mui/material/Chip";

export type StatusBadgeVariant =
  | "pending"
  | "active"
  | "completed"
  | "failed"
  | "stalled"
  | "cancelled"
  | "awaiting_confirmation";

export interface StatusBadgeProps {
  /** The status to display. */
  status: StatusBadgeVariant;
  /** Override the displayed label. Defaults to the capitalized status. */
  label?: string;
  /** MUI Chip size. */
  size?: ChipProps["size"];
  className?: string;
  [key: `data-${string}`]: string;
}

const statusColorMap: Record<
  StatusBadgeVariant,
  ChipProps["color"]
> = {
  pending: "default",
  active: "info",
  completed: "success",
  failed: "error",
  stalled: "warning",
  cancelled: "default",
  awaiting_confirmation: "warning",
};

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

export const StatusBadge = React.forwardRef<HTMLDivElement, StatusBadgeProps>(
  ({ status, label, size = "small", className, ...rest }, ref) => {
    return (
      <Chip
        ref={ref}
        label={label ?? capitalize(status)}
        color={statusColorMap[status]}
        size={size}
        variant="outlined"
        className={className}
        {...rest}
      />
    );
  }
);

export default StatusBadge;

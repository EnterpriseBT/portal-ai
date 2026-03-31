import React from "react";
import Stack from "@mui/material/Stack";
import MuiButton from "@mui/material/Button";
import type { ButtonProps as MuiButtonProps } from "@mui/material/Button";

export interface ActionSuiteItem {
  /** Display label for the button. */
  label: string;
  /** Optional icon rendered before the label (startIcon). */
  icon?: React.ReactNode;
  /** Called when the button is clicked. */
  onClick: () => void;
  /** Whether the button is disabled. */
  disabled?: boolean;
  /** MUI button color. Defaults to "primary". */
  color?: MuiButtonProps["color"];
  /** MUI button variant. Defaults to "outlined". */
  variant?: MuiButtonProps["variant"];
}

export interface ActionsSuiteProps {
  /** Action buttons to render. */
  items: ActionSuiteItem[];
  /** MUI button size applied to all buttons. Defaults to "small". */
  size?: MuiButtonProps["size"];
  className?: string;
  [key: `data-${string}`]: string;
}

export const ActionsSuite = React.forwardRef<HTMLDivElement, ActionsSuiteProps>(
  ({ items, size = "small", className, ...rest }, ref) => {
    if (items.length === 0) return null;

    return (
      <Stack
        ref={ref}
        direction="row"
        spacing={1}
        alignItems="center"
        flexWrap="wrap"
        useFlexGap
        className={className}
        {...rest}
      >
        {items.map((item) => (
          <MuiButton
            key={item.label}
            size={size}
            variant={item.variant ?? "outlined"}
            color={item.color ?? "primary"}
            disabled={item.disabled}
            startIcon={item.icon}
            onClick={item.onClick}
          >
            {item.label}
          </MuiButton>
        ))}
      </Stack>
    );
  },
);

export default ActionsSuite;

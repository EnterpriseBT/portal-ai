import React from "react";
import Stack from "@mui/material/Stack";
import type { ButtonProps as MuiButtonProps } from "@mui/material/Button";

import { GatedButton } from "./GatedButton.js";
import { visibleActionItems } from "./ActionsMenu.js";
import type { ActionGate } from "./ActionGate.js";

export interface ActionSuiteItem {
  /** Display label for the button. */
  label: string;
  /** Optional icon rendered before the label (startIcon). */
  icon?: React.ReactNode;
  /** Called when the button is clicked. */
  onClick: () => void;
  /** How the button renders for this caller (#688); omitted = allow. A
   *  disabled button must say why, so there is no `disabled` flag. */
  gate?: ActionGate;
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
    const visible = visibleActionItems(items);
    if (visible.length === 0) return null;

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
        {visible.map((item) => (
          <GatedButton
            key={item.label}
            size={size}
            variant={item.variant ?? "outlined"}
            color={item.color ?? "primary"}
            gate={item.gate}
            startIcon={item.icon}
            onClick={item.onClick}
          >
            {item.label}
          </GatedButton>
        ))}
      </Stack>
    );
  }
);

export default ActionsSuite;

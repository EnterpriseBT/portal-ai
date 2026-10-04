import React from "react";
import Tooltip from "@mui/material/Tooltip";
import type { SxProps, Theme } from "@mui/material/styles";

import { Button, type ButtonProps } from "./Button.js";
import { Icon, IconName } from "./Icon.js";
import type { ActionGate } from "./ActionGate.js";

export interface GatedButtonProps extends ButtonProps {
  /** How to render for this caller (#688). Omitted = allow. */
  gate?: ActionGate;
}

/**
 * The disabled look without native `disabled`: MUI's `Mui-disabled` sets
 * `pointer-events: none`, which would block the hover tooltip, and a native
 * `disabled` button leaves the tab order, so keyboard users never hear why.
 */
export const gatedDisabledSx = (
  variant: ButtonProps["variant"]
): SxProps<Theme> => ({
  cursor: "not-allowed",
  color: "action.disabled",
  boxShadow: "none",
  borderColor: "action.disabledBackground",
  ...(variant === "contained" || variant === undefined
    ? { bgcolor: "action.disabledBackground" }
    : {}),
  "&:hover": {
    boxShadow: "none",
    bgcolor:
      variant === "contained" || variant === undefined
        ? "action.disabledBackground"
        : "transparent",
    borderColor: "action.disabledBackground",
  },
});

/** A CTA rendered from an {@link ActionGate} (#688). */
export const GatedButton = React.forwardRef<
  HTMLButtonElement,
  GatedButtonProps
>(({ gate, onClick, sx, variant, startIcon, ...props }, ref) => {
  if (gate?.kind === "hide") return null;
  if (gate?.kind === "disable") {
    return (
      <Tooltip title={gate.reason} describeChild>
        <Button
          ref={ref}
          {...props}
          variant={variant}
          startIcon={startIcon}
          aria-disabled="true"
          disableRipple
          onClick={(event) => event.preventDefault()}
          sx={[gatedDisabledSx(variant), ...(Array.isArray(sx) ? sx : [sx])]}
        />
      </Tooltip>
    );
  }
  if (gate?.kind === "upsell") {
    const { onUpgrade } = gate;
    return (
      <Tooltip title={gate.reason} describeChild>
        <Button
          ref={ref}
          {...props}
          variant={variant}
          sx={sx}
          startIcon={<Icon name={IconName.Lock} fontSize="small" />}
          onClick={(event) => {
            event.preventDefault();
            onUpgrade();
          }}
        />
      </Tooltip>
    );
  }
  return (
    <Button
      ref={ref}
      {...props}
      variant={variant}
      startIcon={startIcon}
      sx={sx}
      onClick={onClick}
    />
  );
});

export default GatedButton;

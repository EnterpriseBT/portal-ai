import React from "react";
import Tooltip from "@mui/material/Tooltip";

import { IconButton, type IconButtonProps } from "./IconButton.js";
import type { ActionGate } from "./ActionGate.js";

export interface GatedIconButtonProps extends IconButtonProps {
  /** How to render for this caller (#688). Omitted = allow. */
  gate?: ActionGate;
}

/** An icon-only CTA rendered from an {@link ActionGate} (#688). Keep an
 *  `aria-label`: it's the button's name; the gate's reason is its tooltip. */
export const GatedIconButton = React.forwardRef<
  HTMLButtonElement,
  GatedIconButtonProps
>(({ gate, onClick, sx, ...props }, ref) => {
  if (gate?.kind === "hide") return null;
  if (gate?.kind === "disable") {
    return (
      <Tooltip title={gate.reason} describeChild>
        <IconButton
          ref={ref}
          {...props}
          aria-disabled="true"
          disableRipple
          onClick={(event) => event.preventDefault()}
          sx={[
            { cursor: "not-allowed", color: "action.disabled" },
            ...(Array.isArray(sx) ? sx : [sx]),
          ]}
        />
      </Tooltip>
    );
  }
  if (gate?.kind === "upsell") {
    const { onUpgrade } = gate;
    return (
      <Tooltip title={gate.reason} describeChild>
        <IconButton
          ref={ref}
          {...props}
          sx={sx}
          onClick={(event) => {
            event.preventDefault();
            onUpgrade();
          }}
        />
      </Tooltip>
    );
  }
  return <IconButton ref={ref} {...props} sx={sx} onClick={onClick} />;
});

export default GatedIconButton;

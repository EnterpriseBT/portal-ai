import React from "react";
import Tooltip from "@mui/material/Tooltip";

import { IconButton, type IconButtonProps } from "./IconButton.js";
import type { ActionGate } from "./ActionGate.js";
import { useGateReason } from "./gate-reason.js";

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
  // #793: the reason is the button's description, not only its tooltip.
  const { describedBy, reasonNode } = useGateReason(
    gate,
    props["aria-describedby"]
  );
  if (gate?.kind === "hide") return null;
  if (gate?.kind === "disable") {
    // The theme gives aria-disabled its look (a11yComponents, #793).
    return (
      <>
        <Tooltip title={gate.reason} describeChild>
          <IconButton
            ref={ref}
            {...props}
            aria-disabled="true"
            aria-describedby={describedBy}
            disableRipple
            onClick={(event) => event.preventDefault()}
            sx={sx}
          />
        </Tooltip>
        {reasonNode}
      </>
    );
  }
  if (gate?.kind === "upsell") {
    const { onUpgrade } = gate;
    return (
      <>
        <Tooltip title={gate.reason} describeChild>
          <IconButton
            ref={ref}
            {...props}
            sx={sx}
            aria-describedby={describedBy}
            onClick={(event) => {
              event.preventDefault();
              onUpgrade();
            }}
          />
        </Tooltip>
        {reasonNode}
      </>
    );
  }
  return <IconButton ref={ref} {...props} sx={sx} onClick={onClick} />;
});

export default GatedIconButton;

import React from "react";
import Tooltip from "@mui/material/Tooltip";

import { Button, type ButtonProps } from "./Button.js";
import { Icon, IconName } from "./Icon.js";
import type { ActionGate } from "./ActionGate.js";
import { useGateReason } from "./gate-reason.js";

export interface GatedButtonProps extends ButtonProps {
  /** How to render for this caller (#688). Omitted = allow. */
  gate?: ActionGate;
}

/** A CTA rendered from an {@link ActionGate} (#688). */
export const GatedButton = React.forwardRef<
  HTMLButtonElement,
  GatedButtonProps
>(({ gate, onClick, sx, variant, startIcon, ...props }, ref) => {
  // #793: the reason is the button's description, not only its tooltip.
  const { describedBy, reasonNode } = useGateReason(
    gate,
    props["aria-describedby"]
  );
  if (gate?.kind === "hide") return null;
  if (gate?.kind === "disable") {
    // aria-disabled, not `disabled`: a disabled button leaves the tab order
    // and blocks the tooltip, so nobody hears why. The theme gives
    // aria-disabled its look (a11yComponents, #793).
    return (
      <>
        <Tooltip title={gate.reason} describeChild>
          <Button
            ref={ref}
            {...props}
            variant={variant}
            startIcon={startIcon}
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
          <Button
            ref={ref}
            {...props}
            variant={variant}
            sx={sx}
            aria-describedby={describedBy}
            startIcon={<Icon name={IconName.Lock} fontSize="small" />}
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

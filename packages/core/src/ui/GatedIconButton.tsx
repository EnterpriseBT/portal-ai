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
 *  `aria-label`: it's the button's name; the gate's reason is its
 *  description and tooltip (#793).
 *
 *  Every visible gate renders the same tree, varying only props, so a gate
 *  change updates the focused button in place and focus stays (#793). */
export const GatedIconButton = React.forwardRef<
  HTMLButtonElement,
  GatedIconButtonProps
>(({ gate, onClick, disabled, disableRipple, ...props }, ref) => {
  const { describedBy, reasonNode } = useGateReason(
    gate,
    props["aria-describedby"]
  );
  if (gate?.kind === "hide") return null;
  const blocked = gate?.kind === "disable";
  const upsell = gate?.kind === "upsell" ? gate : null;
  const reason = blocked || upsell ? (gate as { reason: string }).reason : "";
  return (
    <>
      {/* An empty title never opens, so an allowed button has no tooltip. */}
      <Tooltip title={reason} describeChild>
        <IconButton
          ref={ref}
          {...props}
          // The gate wins over a native `disabled`; the theme gives
          // aria-disabled its look (a11yComponents, #793).
          disabled={blocked ? undefined : disabled}
          aria-disabled={blocked ? "true" : undefined}
          aria-describedby={describedBy}
          disableRipple={blocked || disableRipple}
          onClick={(event) => {
            if (blocked) {
              event.preventDefault();
            } else if (upsell) {
              event.preventDefault();
              upsell.onUpgrade();
            } else {
              onClick?.(event);
            }
          }}
        />
      </Tooltip>
      {reasonNode}
    </>
  );
});

export default GatedIconButton;

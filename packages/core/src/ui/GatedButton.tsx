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

/**
 * A CTA rendered from an {@link ActionGate} (#688).
 *
 * Every visible gate renders the same tree (a Tooltip around one Button,
 * then the reason), varying only props (#793). A gate change, such as a
 * dialog's Save turning `disable` while it saves, then updates the focused
 * button in place instead of remounting it, so focus stays on it.
 */
export const GatedButton = React.forwardRef<
  HTMLButtonElement,
  GatedButtonProps
>(({ gate, onClick, startIcon, disabled, disableRipple, ...props }, ref) => {
  // #793: the reason is the button's description, not only its tooltip.
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
        <Button
          ref={ref}
          {...props}
          // aria-disabled, not `disabled`, when the gate blocks: a disabled
          // button leaves the tab order and blocks the tooltip, so nobody
          // hears why. The gate wins over a native `disabled` (#793). The
          // theme gives aria-disabled its look (a11yComponents).
          disabled={blocked ? undefined : disabled}
          aria-disabled={blocked ? "true" : undefined}
          aria-describedby={describedBy}
          disableRipple={blocked || disableRipple}
          startIcon={
            upsell ? <Icon name={IconName.Lock} fontSize="small" /> : startIcon
          }
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

export default GatedButton;

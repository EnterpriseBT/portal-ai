import React, { useId } from "react";

import type { ActionGate } from "./ActionGate.js";

/**
 * #793: a gated control's reason as its permanent description. The tooltip
 * still shows it to sighted users, but MUI only links a tooltip while it's
 * open, so a screen-reader user browsing past the control would miss it.
 *
 * The reason sits in a `hidden` element: `aria-describedby` reads a hidden
 * element's text, and hiding it keeps browse mode from reading it a second
 * time as stray text. It needs no styling, so it adds no layout either.
 */
export function useGateReason(
  gate: ActionGate | undefined,
  describedBy?: string
): { describedBy: string | undefined; reasonNode: React.ReactNode } {
  const id = useId();
  const reason =
    gate?.kind === "disable" || gate?.kind === "upsell" ? gate.reason : null;
  if (!reason) return { describedBy, reasonNode: null };
  return {
    describedBy: describedBy ? `${describedBy} ${id}` : id,
    reasonNode: (
      <span id={id} hidden>
        {reason}
      </span>
    ),
  };
}

import React from "react";

import { Stack, Typography } from "@portalai/core/ui";

import { UpgradeLink } from "./UpgradeLink.component";

export interface ToolPackUpgradeNoteUIProps {
  /** Some built-in pack is outside the org's plan. */
  show: boolean;
}

/**
 * #690: the upsell for tool packs the plan leaves out. Their options stay
 * listed but disabled ("Not included in your plan"), and a disabled option
 * can't hold a clickable link, so the route to a plan that includes them sits
 * under the picker instead.
 */
export const ToolPackUpgradeNoteUI: React.FC<ToolPackUpgradeNoteUIProps> = ({
  show,
}) =>
  show ? (
    <Stack direction="row" spacing={0.5} alignItems="baseline">
      <Typography variant="caption" color="text.secondary">
        Some tool packs aren&apos;t included in your plan.
      </Typography>
      <UpgradeLink variant="caption" />
    </Stack>
  ) : null;

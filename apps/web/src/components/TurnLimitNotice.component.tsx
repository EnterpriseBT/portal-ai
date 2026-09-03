import React from "react";
import Alert from "@mui/material/Alert";
import Box from "@mui/material/Box";

import { UpgradeLink } from "./UpgradeLink.component";

// #498: the in-session surface for an AGENT_TURN_LIMITED send denial. The
// user is *in* the surface that denied them, so this renders inline (not a
// toast, not the generic stream-error banner) and the composer stays usable —
// the ceiling is a rate window, not a lockout.

export interface TurnLimitNoticeUIProps {
  /** The server's denial copy (names the window and its reset). */
  message: string;
  /** Offer the upgrade CTA — set for tiers below the top self-serve tier. */
  showUpgrade: boolean;
}

export const TurnLimitNoticeUI: React.FC<TurnLimitNoticeUIProps> = ({
  message,
  showUpgrade,
}) => (
  <Alert severity="warning" sx={{ mx: 2, my: 1 }}>
    {message}
    {showUpgrade && (
      <Box component="span" sx={{ ml: 1 }}>
        <UpgradeLink />
      </Box>
    )}
  </Alert>
);

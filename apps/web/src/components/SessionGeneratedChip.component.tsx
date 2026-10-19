import React from "react";

import Chip from "@mui/material/Chip";

export interface SessionGeneratedChipUIProps {
  size?: "small" | "medium";
}

/**
 * #641: marks an object an agent created in a portal session. Provenance
 * only: the object is still owned by the user who prompted the agent. Plain
 * text with no link, since the portal may be unreadable to the viewer.
 * Decide whether to show it with `isSessionGenerated` (`@portalai/core`).
 */
export const SessionGeneratedChipUI: React.FC<SessionGeneratedChipUIProps> = ({
  size = "small",
}) => (
  <Chip label="Created in a portal session" size={size} variant="outlined" />
);

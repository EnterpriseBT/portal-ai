import React from "react";
import { Typography, Button } from "@portalai/core/ui";
import Alert from "@mui/material/Alert";

import type { RegionWarning } from "./utils/region-editor.types";

export interface WarningRowUIProps {
  warning: RegionWarning;
  onJump: () => void;
}

export const WarningRowUI: React.FC<WarningRowUIProps> = ({ warning, onJump }) => {
  const severityMap: Record<RegionWarning["severity"], "info" | "warning" | "error"> = {
    info: "info",
    warn: "warning",
    blocker: "error",
  };
  return (
    <Alert
      severity={severityMap[warning.severity]}
      action={
        <Button size="small" onClick={onJump}>
          Jump
        </Button>
      }
    >
      <Typography variant="body2" sx={{ fontWeight: 600 }}>
        {warning.code}
      </Typography>
      <Typography variant="caption" sx={{ display: "block" }}>
        {warning.message}
      </Typography>
      {warning.suggestedFix && (
        <Typography variant="caption" sx={{ display: "block", fontStyle: "italic" }}>
          Suggested fix: {warning.suggestedFix}
        </Typography>
      )}
    </Alert>
  );
};

import React from "react";
import { Box, Typography } from "@portalai/core/ui";

import { confidenceBand } from "./utils/region-editor-colors.util";

export interface ConfidenceChipUIProps {
  label: string;
  score?: number;
}

export const ConfidenceChipUI: React.FC<ConfidenceChipUIProps> = ({
  label,
  score,
}) => {
  const band = confidenceBand(score);
  if (band === "none") return null;
  return (
    <Box
      data-sheet-part="confidence-chip"
      data-confidence={band}
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.75,
        py: 0.125,
        borderRadius: 8,
        borderWidth: 1,
        borderStyle: "solid",
        fontSize: 11,
      }}
    >
      <Typography variant="caption" sx={{ fontWeight: 600 }}>
        {label}
      </Typography>
      <Typography variant="caption">
        {score !== undefined ? `${Math.round(score * 100)}%` : "—"}
      </Typography>
    </Box>
  );
};

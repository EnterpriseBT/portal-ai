import React from "react";
import { Box, Typography } from "@portalai/core/ui";

import {
  confidenceBand,
  CONFIDENCE_BAND_COLOR,
} from "./utils/region-editor-colors.util";

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
      sx={{
        display: "inline-flex",
        alignItems: "center",
        gap: 0.5,
        px: 0.75,
        py: 0.125,
        borderRadius: 8,
        backgroundColor: `${CONFIDENCE_BAND_COLOR[band]}1A`,
        border: "1px solid",
        borderColor: CONFIDENCE_BAND_COLOR[band],
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

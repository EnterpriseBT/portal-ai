import React from "react";

import type { EntityGroupMemberOverlapResponsePayload } from "@portalai/core/contracts";
import { Box, Typography } from "@portalai/core/ui";

export interface OverlapPreviewProps {
  overlap: EntityGroupMemberOverlapResponsePayload | null;
  isLoading: boolean;
}

export const OverlapPreview: React.FC<OverlapPreviewProps> = ({
  overlap,
  isLoading,
}) => {
  if (isLoading) {
    return (
      <Typography variant="body2" color="text.secondary">
        Checking overlap…
      </Typography>
    );
  }

  if (!overlap) return null;

  const pct = overlap.overlapPercentage;
  const color = pct < 5 ? "error" : pct < 50 ? "warning" : undefined;

  return (
    <Box
      data-testid="overlap-preview"
      sx={{
        p: 2,
        borderRadius: 1,
        ...(color === "error" && {
          bgcolor: "error.light",
          color: "error.contrastText",
        }),
        ...(color === "warning" && {
          bgcolor: "warning.light",
          color: "warning.contrastText",
        }),
        ...(!color && { bgcolor: "grey.100" }),
      }}
    >
      <Typography variant="h4" data-testid="overlap-percentage">
        {Math.round(pct)}% overlap
      </Typography>
      <Typography variant="body2" data-testid="overlap-counts">
        {overlap.matchingRecordCount} of {overlap.sourceRecordCount} source
        records match {overlap.matchingRecordCount} of{" "}
        {overlap.targetRecordCount} target records
      </Typography>
    </Box>
  );
};

import React from "react";
import { Box, Stack, Typography, Button, Divider } from "@portalai/core/ui";

import { ConfidenceChipUI } from "./ConfidenceChip.component";
import { WarningRowUI } from "./WarningRow.component";
import { formatBounds } from "./utils/a1-notation.util";
import {
  confidenceBand,
  CONFIDENCE_BAND_COLOR,
} from "./utils/region-editor-colors.util";
import type { RegionDraft } from "./utils/region-editor.types";

export interface RegionReviewCardUIProps {
  region: RegionDraft;
  onJump: () => void;
  onEditBinding: (sourceLocator: string) => void;
}

export const RegionReviewCardUI: React.FC<RegionReviewCardUIProps> = ({
  region,
  onJump,
  onEditBinding,
}) => {
  return (
    <Box
      sx={{
        p: 1.5,
        borderRadius: 1,
        backgroundColor: "grey.50",
        border: "1px solid",
        borderColor: "divider",
      }}
    >
      <Stack
        direction="row"
        justifyContent="space-between"
        alignItems={{ xs: "flex-start", sm: "center" }}
        spacing={1}
        flexWrap="wrap"
        useFlexGap
        sx={{ mb: 0.5 }}
      >
        <Stack
          direction="row"
          spacing={1}
          alignItems="center"
          flexWrap="wrap"
          useFlexGap
        >
          <Typography variant="body2" sx={{ fontWeight: 600 }}>
            {region.proposedLabel ?? formatBounds(region.bounds)}
          </Typography>
          <Typography variant="caption" color="text.secondary">
            {formatBounds(region.bounds)}
          </Typography>
          <ConfidenceChipUI label="Region" score={region.confidence} />
        </Stack>
        <Button size="small" variant="text" onClick={onJump}>
          Jump to region
        </Button>
      </Stack>

      {region.columnBindings && region.columnBindings.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {region.columnBindings.map((binding) => {
              const band = confidenceBand(binding.confidence);
              return (
                <Box
                  key={binding.sourceLocator}
                  onClick={() => onEditBinding(binding.sourceLocator)}
                  sx={{
                    display: "inline-flex",
                    alignItems: "center",
                    gap: 0.5,
                    px: 1,
                    py: 0.25,
                    borderRadius: 16,
                    border: "1px solid",
                    borderColor: CONFIDENCE_BAND_COLOR[band],
                    backgroundColor: "background.paper",
                    cursor: "pointer",
                    fontSize: 12,
                  }}
                >
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {binding.sourceLocator}
                  </Typography>
                  <span>→</span>
                  <Typography variant="caption">
                    {binding.columnDefinitionLabel ??
                      binding.columnDefinitionId ??
                      "—"}
                  </Typography>
                  <Box
                    sx={{
                      width: 6,
                      height: 6,
                      borderRadius: "50%",
                      backgroundColor: CONFIDENCE_BAND_COLOR[band],
                    }}
                  />
                </Box>
              );
            })}
          </Stack>
        </>
      )}

      {region.warnings && region.warnings.length > 0 && (
        <Stack spacing={0.75} sx={{ mt: 1 }}>
          {region.warnings.map((w, i) => (
            <WarningRowUI key={i} warning={w} onJump={onJump} />
          ))}
        </Stack>
      )}
    </Box>
  );
};

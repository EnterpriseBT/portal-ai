import React from "react";
import { Box, Stack, Typography, Button, Divider } from "@portalai/core/ui";
import MuiChip from "@mui/material/Chip";

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
  /**
   * Fires when a binding chip is clicked. Receives the serialised
   * sourceLocator and the chip DOM node so callers can anchor a popover to
   * the clicked chip (the `ReviewStepUI` binding editor does).
   */
  onEditBinding: (sourceLocator: string, anchorEl: HTMLElement) => void;
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
              const isExcluded = binding.excluded === true;
              const ariaLabel = isExcluded
                ? `Excluded — click to edit: ${binding.sourceLocator}`
                : `Edit binding: ${binding.sourceLocator}`;
              return (
                <Box
                  key={binding.sourceLocator}
                  component="button"
                  type="button"
                  aria-label={ariaLabel}
                  onClick={(e) =>
                    onEditBinding(
                      binding.sourceLocator,
                      e.currentTarget as HTMLElement
                    )
                  }
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
                    opacity: isExcluded ? 0.55 : 1,
                    textDecoration: isExcluded ? "line-through" : "none",
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
                  {isExcluded ? (
                    <MuiChip
                      label="Excluded"
                      size="small"
                      variant="outlined"
                      sx={{ height: 18, textDecoration: "none" }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: CONFIDENCE_BAND_COLOR[band],
                      }}
                    />
                  )}
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

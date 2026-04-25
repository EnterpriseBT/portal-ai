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
import type { RegionBindingErrors } from "./utils/region-editor-validation.util";

type ChipBand = ReturnType<typeof confidenceBand>;

export interface RegionReviewCardUIProps {
  region: RegionDraft;
  onJump: () => void;
  /**
   * Fires when a binding chip is clicked. Receives the serialised
   * sourceLocator and the chip DOM node so callers can anchor a popover to
   * the clicked chip (the `ReviewStepUI` binding editor does).
   */
  onEditBinding: (sourceLocator: string, anchorEl: HTMLElement) => void;
  /**
   * Per-binding validation errors keyed by serialised `sourceLocator`.
   * Chips with an entry render in the error palette with an "Invalid" pill
   * so the user can spot problem bindings without opening each one.
   */
  bindingErrors?: RegionBindingErrors;
  /**
   * Looks up a ColumnDefinition's display label by id. Used to resolve labels
   * for the pivot-segment and cellValueField chips, which carry only a
   * `columnDefinitionId` (no embedded label like a `ColumnBindingDraft`).
   */
  resolveColumnLabel?: (columnDefinitionId: string) => string | undefined;
}

interface ReviewChip {
  key: string;
  /** Source label rendered on the left of the chip arrow. */
  source: string;
  /** Display label rendered on the right; falls back to id, then "—". */
  columnDefinitionLabel?: string;
  columnDefinitionId?: string | null;
  band: ChipBand;
  excluded: boolean;
  invalid: boolean;
  /**
   * Optional click handler. Logical-field chips (pivot axisName,
   * cellValueField) leave this undefined since this card doesn't yet support
   * editing those slots — they render as a static chip with the same shape.
   */
  onClick?: (anchorEl: HTMLElement) => void;
  ariaLabel: string;
}

function buildChips(
  region: RegionDraft,
  bindingErrors: RegionBindingErrors | undefined,
  onEditBinding: RegionReviewCardUIProps["onEditBinding"],
  resolveColumnLabel: RegionReviewCardUIProps["resolveColumnLabel"]
): ReviewChip[] {
  const chips: ReviewChip[] = [];

  for (const binding of region.columnBindings ?? []) {
    const excluded = binding.excluded === true;
    const invalid = !excluded && bindingErrors?.[binding.sourceLocator] !== undefined;
    chips.push({
      key: `binding:${binding.sourceLocator}`,
      source: binding.sourceLocator,
      columnDefinitionLabel: binding.columnDefinitionLabel,
      columnDefinitionId: binding.columnDefinitionId,
      band: confidenceBand(binding.confidence),
      excluded,
      invalid,
      onClick: (anchor) => onEditBinding(binding.sourceLocator, anchor),
      ariaLabel: excluded
        ? `Excluded — click to edit: ${binding.sourceLocator}`
        : invalid
          ? `Invalid — click to edit: ${binding.sourceLocator}`
          : `Edit binding: ${binding.sourceLocator}`,
    });
  }

  for (const axis of ["row", "column"] as const) {
    for (const seg of region.segmentsByAxis?.[axis] ?? []) {
      if (seg.kind !== "pivot") continue;
      const id = seg.columnDefinitionId;
      const label = id ? resolveColumnLabel?.(id) : undefined;
      // Pivot segment binds to the catalog by name match — band tracks
      // whether the slot is filled, not a numeric confidence we'd otherwise
      // surface in the popover.
      chips.push({
        key: `pivot:${seg.id}`,
        source: seg.axisName,
        columnDefinitionLabel: label,
        columnDefinitionId: id ?? null,
        band: id ? "green" : "red",
        excluded: false,
        invalid: !id,
        ariaLabel: id
          ? `Pivot axis "${seg.axisName}" bound to ${label ?? id}`
          : `Pivot axis "${seg.axisName}" — unbound`,
      });
    }
  }

  if (region.cellValueField) {
    const id = region.cellValueField.columnDefinitionId;
    const label = id ? resolveColumnLabel?.(id) : undefined;
    chips.push({
      key: "cellValueField",
      source: region.cellValueField.name,
      columnDefinitionLabel: label,
      columnDefinitionId: id ?? null,
      band: id ? "green" : "red",
      excluded: false,
      invalid: !id,
      ariaLabel: id
        ? `Cell value "${region.cellValueField.name}" bound to ${label ?? id}`
        : `Cell value "${region.cellValueField.name}" — unbound`,
    });
  }

  return chips;
}

export const RegionReviewCardUI: React.FC<RegionReviewCardUIProps> = ({
  region,
  onJump,
  onEditBinding,
  bindingErrors,
  resolveColumnLabel,
}) => {
  const chips = buildChips(
    region,
    bindingErrors,
    onEditBinding,
    resolveColumnLabel
  );

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

      {chips.length > 0 && (
        <>
          <Divider sx={{ my: 1 }} />
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {chips.map((chip) => {
              const interactive = chip.onClick !== undefined;
              // Native `<button>` styling resolves text color against
              // `buttontext` / `Canvas` instead of the document's
              // `text.primary`, which on the grey.50 card background
              // renders as a near-invisible pale gray. Lock both the color
              // and font-family to the document so interactive (button)
              // chips and display-only (div) chips look identical.
              const sx = {
                display: "inline-flex",
                alignItems: "center",
                gap: 0.5,
                px: 1,
                py: 0.25,
                borderRadius: 16,
                border: "1px solid",
                borderColor: chip.invalid
                  ? "error.main"
                  : CONFIDENCE_BAND_COLOR[chip.band],
                backgroundColor: chip.invalid
                  ? "error.light"
                  : "background.paper",
                color: "text.primary",
                fontFamily: "inherit",
                cursor: interactive ? "pointer" : "default",
                fontSize: 12,
                opacity: chip.excluded ? 0.55 : 1,
                textDecoration: chip.excluded ? "line-through" : "none",
              } as const;
              const inner = (
                <>
                  <Typography variant="caption" sx={{ fontWeight: 600 }}>
                    {chip.source}
                  </Typography>
                  <span>→</span>
                  <Typography variant="caption">
                    {chip.columnDefinitionLabel ??
                      chip.columnDefinitionId ??
                      "—"}
                  </Typography>
                  {chip.excluded ? (
                    <MuiChip
                      label="Excluded"
                      size="small"
                      variant="outlined"
                      sx={{ height: 18, textDecoration: "none" }}
                    />
                  ) : chip.invalid ? (
                    <MuiChip
                      label={chip.columnDefinitionId ? "Invalid" : "Unbound"}
                      size="small"
                      color="error"
                      sx={{ height: 18 }}
                    />
                  ) : (
                    <Box
                      sx={{
                        width: 6,
                        height: 6,
                        borderRadius: "50%",
                        backgroundColor: CONFIDENCE_BAND_COLOR[chip.band],
                      }}
                    />
                  )}
                </>
              );
              return interactive ? (
                <Box
                  key={chip.key}
                  component="button"
                  type="button"
                  aria-label={chip.ariaLabel}
                  onClick={(e) =>
                    chip.onClick!(e.currentTarget as HTMLElement)
                  }
                  sx={sx}
                >
                  {inner}
                </Box>
              ) : (
                <Box
                  key={chip.key}
                  role="status"
                  aria-label={chip.ariaLabel}
                  sx={sx}
                >
                  {inner}
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

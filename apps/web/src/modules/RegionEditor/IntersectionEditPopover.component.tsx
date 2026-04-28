import React from "react";
import MuiChip from "@mui/material/Chip";
import MuiPopover from "@mui/material/Popover";
import { Box, Button, Stack, TextInput, Typography } from "@portalai/core/ui";

import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";

export interface IntersectionEditPopoverUIProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  /** Composite intersection display label — `<axisName-row> × <axisName-col>`. */
  label: string;
  /**
   * Current cell-value field name shown in the input. The container
   * resolves this from the per-intersection override (when set) or the
   * region-level fallback (when not). The popover doesn't care which
   * source produced it.
   */
  value: string;
  /**
   * Placeholder rendered when the input is empty — used to surface the
   * region-level fallback name so the user sees what they're inheriting.
   */
  fallbackName?: string;
  /**
   * `true` when the value comes from a per-intersection override (i.e.
   * `region.intersectionCellValueFields[id]` is set). Drives the "Inherits
   * from region" / "Overridden" pill above the input.
   */
  overridden: boolean;
  onChange: (value: string) => void;
  /**
   * Clear the per-intersection override entirely so the block falls back
   * to the region-level `cellValueField`. Disabled when `overridden` is
   * `false` (nothing to clear).
   */
  onClear: () => void;
  onClose: () => void;
}

export const IntersectionEditPopoverUI: React.FC<
  IntersectionEditPopoverUIProps
> = ({
  open,
  anchorEl,
  label,
  value,
  fallbackName,
  overridden,
  onChange,
  onClear,
  onClose,
}) => {
  const inputRef = useDialogAutoFocus<HTMLInputElement>(open);

  return (
    <MuiPopover
      open={open}
      anchorEl={anchorEl}
      onClose={onClose}
      anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
      transformOrigin={{ vertical: "top", horizontal: "left" }}
      slotProps={{
        paper: {
          role: "dialog",
          "aria-label": "Edit intersection cell-value field",
          sx: { width: 320, maxWidth: "95vw", p: 2 },
        } as object,
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <MuiChip size="small" label="Pivot intersection" color="warning" />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {label}
          </Typography>
        </Stack>

        <MuiChip
          size="small"
          variant={overridden ? "filled" : "outlined"}
          color={overridden ? "primary" : "default"}
          label={
            overridden
              ? "Overridden — this block emits a separate field"
              : `Inherits from region${fallbackName ? ` ("${fallbackName}")` : ""}`
          }
          sx={{ alignSelf: "flex-start" }}
        />

        <TextInput
          inputRef={inputRef}
          size="small"
          fullWidth
          label="Cell-value field name"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={fallbackName}
          helperText={
            overridden
              ? "Each non-skip body cell inside this intersection emits a record under this name."
              : "Empty leaves the block on the region-level cell-value field."
          }
          slotProps={{
            htmlInput: {
              "aria-label": "Cell-value field name for this intersection",
            },
          }}
        />

        <Box sx={{ pt: 0.5 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            <Button
              type="button"
              variant="text"
              color="error"
              disabled={!overridden}
              onClick={onClear}
              aria-label="Clear intersection override"
              title={
                overridden
                  ? undefined
                  : "Already inheriting from the region — nothing to clear."
              }
            >
              Clear override
            </Button>
            <Button type="button" variant="text" onClick={onClose}>
              Close
            </Button>
          </Stack>
        </Box>
      </Stack>
    </MuiPopover>
  );
};

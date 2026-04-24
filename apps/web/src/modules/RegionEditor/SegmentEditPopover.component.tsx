import React from "react";
import MuiChip from "@mui/material/Chip";
import MuiPopover from "@mui/material/Popover";
import {
  Box,
  Button,
  Checkbox,
  Divider,
  Stack,
  TextInput,
  Typography,
} from "@portalai/core/ui";
import type {
  AxisMember,
  Segment,
  Terminator,
} from "@portalai/core/contracts";

import { TerminatorFormUI } from "./TerminatorForm.component";

type SegmentKind = Segment["kind"];

export interface SegmentEditPopoverUIProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  axis: AxisMember;
  segment: Segment;
  /** Whether this segment is the tail of its axis. Gates the dynamic toggle. */
  isTail: boolean;
  /**
   * Whether this segment may be removed. Typically `false` when it is the
   * only segment on its axis — in that case the user collapses the whole
   * header axis instead of removing an individual segment.
   */
  canRemove?: boolean;
  onChangeAxisName: (value: string) => void;
  onToggleDynamic: (on: boolean) => void;
  onChangeTerminator: (terminator: Terminator) => void;
  onConvert: (toKind: SegmentKind) => void;
  /** When provided, renders a "Delete segment" button. */
  onRemove?: () => void;
  onClose: () => void;
}

const KIND_CHIP_LABEL: Record<SegmentKind, string> = {
  field: "Field",
  pivot: "Pivot",
  skip: "Skip",
};

function defaultTerminator(): Terminator {
  return { kind: "untilBlank", consecutiveBlanks: 2 };
}

export const SegmentEditPopoverUI: React.FC<SegmentEditPopoverUIProps> = ({
  open,
  anchorEl,
  axis,
  segment,
  isTail,
  canRemove = true,
  onChangeAxisName,
  onToggleDynamic,
  onChangeTerminator,
  onConvert,
  onRemove,
  onClose,
}) => {
  const kinds: SegmentKind[] = ["field", "pivot", "skip"];
  const isPivot = segment.kind === "pivot";
  const dynamic = isPivot ? segment.dynamic : undefined;
  const dynamicOn = !!dynamic;

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
          "aria-label": "Edit segment",
          sx: { width: 340, maxWidth: "95vw", p: 2 },
        } as object,
      }}
    >
      <Stack spacing={1.5}>
        <Stack direction="row" spacing={1} alignItems="center">
          <MuiChip size="small" label={`${axis} axis`} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {KIND_CHIP_LABEL[segment.kind]} · {segment.positionCount}
          </Typography>
        </Stack>

        {isPivot && (
          <TextInput
            size="small"
            fullWidth
            label="Axis name"
            value={segment.axisName}
            onChange={(e) => onChangeAxisName(e.target.value)}
            required
            slotProps={{
              htmlInput: { "aria-label": "Axis name" },
            }}
          />
        )}

        {isPivot && isTail && (
          <>
            <Checkbox
              checked={dynamicOn}
              onChange={(checked) => onToggleDynamic(checked)}
              label="Can this segment grow?"
            />
            {dynamicOn && (
              <Box sx={{ pl: 3.5 }}>
                <TerminatorFormUI
                  terminator={dynamic?.terminator ?? defaultTerminator()}
                  onChange={onChangeTerminator}
                  idPrefix="segment terminator"
                />
              </Box>
            )}
          </>
        )}

        <Divider />

        <Stack spacing={0.5}>
          <Typography
            variant="caption"
            sx={{
              fontWeight: 600,
              textTransform: "uppercase",
              color: "text.secondary",
            }}
          >
            Convert to
          </Typography>
          <Stack direction="row" spacing={1} flexWrap="wrap" useFlexGap>
            {kinds.map((kind) => (
              <Button
                key={kind}
                size="small"
                type="button"
                variant={kind === segment.kind ? "contained" : "outlined"}
                disabled={kind === segment.kind}
                onClick={() => onConvert(kind)}
              >
                {KIND_CHIP_LABEL[kind]}
              </Button>
            ))}
          </Stack>
        </Stack>

        <Box sx={{ pt: 0.5 }}>
          <Stack
            direction="row"
            justifyContent="space-between"
            alignItems="center"
          >
            {onRemove ? (
              <Button
                type="button"
                variant="text"
                color="error"
                disabled={!canRemove}
                onClick={onRemove}
                aria-label="Delete segment"
                title={
                  canRemove
                    ? undefined
                    : "Can't delete the only segment on this axis — remove the whole axis instead."
                }
              >
                Delete segment
              </Button>
            ) : (
              <span />
            )}
            <Button type="button" variant="text" onClick={onClose}>
              Close
            </Button>
          </Stack>
        </Box>
      </Stack>
    </MuiPopover>
  );
};

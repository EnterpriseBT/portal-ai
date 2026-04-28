import React from "react";
import MuiPopover from "@mui/material/Popover";
import {
  Box,
  Button,
  Checkbox,
  Stack,
  Typography,
} from "@portalai/core/ui";
import type { AxisMember, Terminator } from "@portalai/core/contracts";

import { TerminatorFormUI } from "./TerminatorForm.component";

export interface RecordAxisTerminatorPopoverUIProps {
  open: boolean;
  anchorEl: HTMLElement | null;
  /** Axis the terminator applies to (row/column). Used only for the header
   *  label; the caller writes through `onChange`. */
  recordsAxis: AxisMember;
  /** Currently-set terminator, or undefined when the extent is not bounded. */
  terminator?: Terminator;
  onToggle: (on: boolean) => void;
  onChangeTerminator: (terminator: Terminator) => void;
  onClose: () => void;
}

function defaultTerminator(): Terminator {
  return { kind: "untilBlank", consecutiveBlanks: 2 };
}

export const RecordAxisTerminatorPopoverUI: React.FC<
  RecordAxisTerminatorPopoverUIProps
> = ({
  open,
  anchorEl,
  recordsAxis,
  terminator,
  onToggle,
  onChangeTerminator,
  onClose,
}) => {
  const on = !!terminator;
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
          "aria-label": "Region extent",
          sx: { width: 320, maxWidth: "95vw", p: 2 },
        } as object,
      }}
    >
      <Stack spacing={1.25}>
        <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
          Extent · {recordsAxis} axis
        </Typography>
        <Typography variant="caption" color="text.secondary">
          Let the region grow along the {recordsAxis} axis until a terminator
          is hit. Leave off to keep the bounds fixed.
        </Typography>

        <Checkbox
          checked={on}
          onChange={(checked) => onToggle(checked)}
          label="Grow until terminator"
        />

        {on && (
          <Box sx={{ pl: 3.5 }}>
            <TerminatorFormUI
              terminator={terminator ?? defaultTerminator()}
              onChange={onChangeTerminator}
              idPrefix="record axis terminator"
            />
          </Box>
        )}

        <Stack direction="row" justifyContent="flex-end">
          <Button type="button" variant="text" onClick={onClose}>
            Close
          </Button>
        </Stack>
      </Stack>
    </MuiPopover>
  );
};

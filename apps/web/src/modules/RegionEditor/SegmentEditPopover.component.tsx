import React, { useEffect, useRef } from "react";
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
import { useDialogAutoFocus } from "../../utils/use-dialog-autofocus.util";

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
  /**
   * For field segments only: the cell-derived header for each position,
   * index-aligned with the segment's positions (length === positionCount).
   * Empty string means the cell is blank — surfaced as a placeholder so the
   * user knows there's no label to inherit. The popover renders these as
   * `<TextInput placeholder>` underneath the override value.
   */
  cellPlaceholders?: string[];
  onChangeAxisName: (value: string) => void;
  /**
   * For field segments only: emit the next per-position headers array
   * (length === positionCount). Pass `undefined` when every entry is empty
   * so the segment falls back to cell-derived headers across the board.
   */
  onChangeHeaders?: (headers: string[] | undefined) => void;
  /**
   * For field segments only: emit the next per-position skipped flags
   * array (length === positionCount). Pass `undefined` when no positions
   * are skipped so the segment cleanly drops the field instead of
   * carrying an all-`false` array.
   */
  onChangeSkipped?: (skipped: boolean[] | undefined) => void;
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

/**
 * Build the next per-position headers array for a field segment when the
 * user edits one position. Returns `undefined` (clearing the override
 * field) when every entry comes back empty so the segment cleanly falls
 * back to cell-derived headers — the schema's optionality stays meaningful
 * instead of accumulating empty arrays.
 */
function nextFieldHeaders(
  current: string[] | undefined,
  positionCount: number,
  index: number,
  value: string
): string[] | undefined {
  const next = new Array<string>(positionCount).fill("");
  if (current) {
    for (let i = 0; i < Math.min(current.length, positionCount); i++) {
      next[i] = current[i];
    }
  }
  next[index] = value;
  if (next.every((v) => v === "")) return undefined;
  return next;
}

/**
 * Mirror `nextFieldHeaders` for the `skipped` array. Drops the field
 * (returns `undefined`) when no positions are skipped so the schema
 * doesn't carry an all-false sentinel array.
 */
function nextFieldSkipped(
  current: boolean[] | undefined,
  positionCount: number,
  index: number,
  value: boolean
): boolean[] | undefined {
  const next = new Array<boolean>(positionCount).fill(false);
  if (current) {
    for (let i = 0; i < Math.min(current.length, positionCount); i++) {
      next[i] = current[i];
    }
  }
  next[index] = value;
  if (next.every((v) => !v)) return undefined;
  return next;
}

export const SegmentEditPopoverUI: React.FC<SegmentEditPopoverUIProps> = ({
  open,
  anchorEl,
  axis,
  segment,
  isTail,
  canRemove = true,
  cellPlaceholders,
  onChangeAxisName,
  onChangeHeaders,
  onChangeSkipped,
  onToggleDynamic,
  onChangeTerminator,
  onConvert,
  onRemove,
  onClose,
}) => {
  const kinds: SegmentKind[] = ["field", "pivot", "skip"];
  const isPivot = segment.kind === "pivot";
  const isField = segment.kind === "field";
  const dynamic = isPivot ? segment.dynamic : undefined;
  const dynamicOn = !!dynamic;
  // Focus the axis-name input when the popover opens for a pivot segment
  // AND when the user converts a non-pivot segment to pivot from inside
  // this popover (the input mounts at that moment, and the hook re-runs
  // because its `open` argument flips from false to true).
  const axisNameRef = useDialogAutoFocus<HTMLInputElement>(open && isPivot);
  // For field segments: focus the first position whose cell is blank — that's
  // the most likely target ("give this nameless column a label"). When every
  // cell already has a value the focus falls through to position 0 so the
  // user can rename starting from the leftmost column.
  const fieldHeaderFocusIndex = isField
    ? Math.max(
        0,
        (cellPlaceholders ?? []).findIndex((p) => !p?.trim())
      )
    : -1;
  const fieldHeaderRefs = useRef<(HTMLInputElement | null)[]>([]);
  useEffect(() => {
    if (!open || !isField) return;
    // Match useDialogAutoFocus's defer — wait past the popover's transition
    // before grabbing focus, otherwise MUI's focus trap fights us.
    const timer = setTimeout(() => {
      const input = fieldHeaderRefs.current[fieldHeaderFocusIndex];
      input?.focus();
      input?.select();
    }, 50);
    return () => clearTimeout(timer);
  }, [open, isField, fieldHeaderFocusIndex]);

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
      <Stack
        spacing={1.5}
        onKeyDown={(e) => {
          // Enter inside any popover input commits the in-progress value
          // (every input is controlled and writes on change, so closing
          // here is purely a "done" affordance) and dismisses the
          // popover. Keys inside textareas / multi-line widgets land on
          // their own handlers — Stack's onKeyDown only catches what
          // bubbles, and a textarea's Enter doesn't bubble as a plain
          // "Enter" once shift/meta modifiers are held.
          if (e.key !== "Enter") return;
          if (e.shiftKey || e.metaKey || e.ctrlKey || e.altKey) return;
          // The "Convert to" pivot/field/skip buttons share the popover —
          // pressing Enter while one of them has focus should activate
          // the button, not dismiss. The buttons emit a click on Enter
          // natively; let that fire and skip the close.
          const target = e.target as HTMLElement | null;
          if (target?.tagName === "BUTTON") return;
          e.preventDefault();
          onClose();
        }}
      >
        <Stack direction="row" spacing={1} alignItems="center">
          <MuiChip size="small" label={`${axis} axis`} />
          <Typography variant="subtitle2" sx={{ fontWeight: 600 }}>
            {KIND_CHIP_LABEL[segment.kind]} · {segment.positionCount}
          </Typography>
        </Stack>

        {isPivot && (
          <TextInput
            inputRef={axisNameRef}
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

        {isField && onChangeHeaders && (
          <Stack spacing={1}>
            <Typography
              variant="caption"
              sx={{
                fontWeight: 600,
                textTransform: "uppercase",
                color: "text.secondary",
              }}
            >
              Field headers
            </Typography>
            {Array.from({ length: segment.positionCount }, (_, i) => {
              const cell = cellPlaceholders?.[i] ?? "";
              const skipped = segment.skipped?.[i] === true;
              return (
                <Stack
                  key={i}
                  direction="row"
                  spacing={1}
                  alignItems="flex-start"
                >
                  <Box sx={{ flex: 1, minWidth: 0 }}>
                    <TextInput
                      inputRef={(el: HTMLInputElement | null) => {
                        fieldHeaderRefs.current[i] = el;
                      }}
                      size="small"
                      fullWidth
                      label={`Position ${i + 1}`}
                      value={segment.headers?.[i] ?? ""}
                      disabled={skipped}
                      onChange={(e) =>
                        onChangeHeaders(
                          nextFieldHeaders(
                            segment.headers,
                            segment.positionCount,
                            i,
                            e.target.value
                          )
                        )
                      }
                      placeholder={cell || `(unlabeled — ${axis === "row" ? "column" : "row"} ${i + 1})`}
                      helperText={
                        skipped
                          ? "Skipped — column is omitted from records"
                          : cell
                            ? `Cell value: ${cell}`
                            : "Cell is blank"
                      }
                      slotProps={{
                        htmlInput: {
                          "aria-label": `Field header for position ${i + 1}`,
                        },
                      }}
                    />
                  </Box>
                  {onChangeSkipped && (
                    <Box sx={{ pt: 1 }}>
                      <Checkbox
                        checked={skipped}
                        onChange={(checked) =>
                          onChangeSkipped(
                            nextFieldSkipped(
                              segment.skipped,
                              segment.positionCount,
                              i,
                              checked
                            )
                          )
                        }
                        label="Skip"
                        inputProps={{
                          "aria-label": `Skip field at position ${i + 1}`,
                        }}
                      />
                    </Box>
                  )}
                </Stack>
              );
            })}
          </Stack>
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

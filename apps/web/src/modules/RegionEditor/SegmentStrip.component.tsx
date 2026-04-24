import React from "react";
import MuiChip from "@mui/material/Chip";
import AllInclusiveIcon from "@mui/icons-material/AllInclusive";
import CancelIcon from "@mui/icons-material/Cancel";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import { alpha, useTheme } from "@mui/material/styles";
import { Box, Button, Stack, Typography } from "@portalai/core/ui";
import type { AxisMember, Segment } from "@portalai/core/contracts";

import { colIndexToLetter } from "./utils/a1-notation.util";

export interface SegmentStripUIProps {
  /** The axis this strip represents. Chip clicks, add-segment, and the
   *  optional add-header-axis emission all reference this axis. */
  axis: AxisMember;
  segments: Segment[];
  /** Optional uppercase section label (e.g. "Row axis"). When omitted a
   *  sensible default derived from `axis` is used. */
  axisLabel?: string;
  /**
   * The axis-start coordinate of the enclosing region — `startCol` for a
   * row-axis strip, `startRow` for a column-axis strip. Used to render the
   * cell-range covered by each segment (e.g. `B–D` or rows `2–4`). When
   * omitted the range column is hidden.
   */
  axisStart?: number;
  onEditSegment: (
    axis: AxisMember,
    segmentIndex: number,
    anchor: HTMLElement
  ) => void;
  onAddSegment: (axis: AxisMember, kind: Segment["kind"]) => void;
  /**
   * Fires when the user clicks the chip's delete (×) button. The last remaining
   * segment on an axis can't be deleted from here (the whole axis must be
   * collapsed instead); when omitted the chips render without a delete button.
   */
  onRemoveSegment?: (axis: AxisMember, segmentIndex: number) => void;
  /**
   * Provided only when the *other* axis isn't already a header axis — the
   * strip renders an "Add <other> header axis" button that forwards this
   * callback with the axis to promote. When `undefined`, the button is
   * hidden (refinement 1 forbids duplicate header axes).
   */
  onAddHeaderAxis?: (otherAxis: AxisMember) => void;
}

type KindTone = {
  label: string;
  filled: boolean;
  /** Palette role; resolved to an actual colour from the current theme. */
  palette: "primary" | "secondary" | "info" | "grey";
};

const KIND_TONE: Record<Segment["kind"], KindTone> = {
  field: { label: "Field", filled: true, palette: "info" },
  pivot: { label: "Pivot", filled: true, palette: "secondary" },
  skip: { label: "Skip", filled: false, palette: "grey" },
};

function otherAxis(axis: AxisMember): AxisMember {
  return axis === "row" ? "column" : "row";
}

function pivotDisplayName(seg: Segment): string {
  if (seg.kind !== "pivot") return "";
  return seg.axisName.trim() || "(unnamed)";
}

/**
 * Offset of segment `index` along its axis, measured from the start of the
 * region in that axis's coordinate space.
 */
function segmentOffset(segments: Segment[], index: number): number {
  let offset = 0;
  for (let i = 0; i < index; i++) offset += segments[i].positionCount;
  return offset;
}

function rangeLabel(
  axis: AxisMember,
  axisStart: number,
  offset: number,
  count: number
): string {
  const from = axisStart + offset;
  const to = from + count - 1;
  if (axis === "row") {
    const f = colIndexToLetter(from);
    const t = colIndexToLetter(to);
    return f === t ? f : `${f}–${t}`;
  }
  // Column axis: positions are rows — render as 1-indexed row numbers.
  return from === to ? `${from + 1}` : `${from + 1}–${to + 1}`;
}

export const SegmentStripUI: React.FC<SegmentStripUIProps> = ({
  axis,
  segments,
  axisLabel,
  axisStart,
  onEditSegment,
  onAddSegment,
  onRemoveSegment,
  onAddHeaderAxis,
}) => {
  const theme = useTheme();
  const label = axisLabel ?? `${axis} axis`;
  const other = otherAxis(axis);
  // Adding a segment never grows the region — it donates one position from
  // an existing segment. If every segment is already at positionCount 1 there
  // is no donor, so the add buttons are disabled with an explanatory tooltip.
  const canAddSegment = segments.some((s) => s.positionCount > 1);
  const addDisabledReason = canAddSegment
    ? undefined
    : "No room — every segment already occupies a single position. Resize the region first.";

  const resolveColor = (palette: KindTone["palette"]) => {
    if (palette === "grey") {
      return {
        bg: theme.palette.mode === "dark" ? theme.palette.grey[800] : theme.palette.grey[200],
        fg: theme.palette.text.primary,
        border: theme.palette.divider,
      };
    }
    const p = theme.palette[palette];
    return { bg: p.main, fg: p.contrastText, border: p.main };
  };

  return (
    <Stack spacing={0.75} aria-label={`${axis} segment strip`}>
      <Typography
        variant="caption"
        sx={{
          fontWeight: 600,
          textTransform: "uppercase",
          color: "text.secondary",
        }}
      >
        {label}
      </Typography>

      <Box
        sx={{
          display: "flex",
          flexWrap: "wrap",
          gap: 0.75,
          rowGap: 1,
          alignItems: "center",
        }}
      >
        {segments.map((seg, i) => {
          const tone = KIND_TONE[seg.kind];
          const colors = resolveColor(tone.palette);
          const isDynamic = seg.kind === "pivot" && !!seg.dynamic;
          const offset = segmentOffset(segments, i);
          const range =
            axisStart !== undefined
              ? rangeLabel(axis, axisStart, offset, seg.positionCount)
              : null;
          const primary =
            seg.kind === "pivot" ? pivotDisplayName(seg) : tone.label;
          // Screen readers still get the legacy "· count · ∞" tail so existing
          // assertions on the dynamic suffix continue to pass, and the text is
          // meaningful when announced.
          const accessibleLabel = isDynamic
            ? `${primary} · ${seg.positionCount} · ∞`
            : `${primary} · ${seg.positionCount}`;
          // Deleting the last segment on an axis collapses the whole axis
          // back out (handler-side), so the X is allowed on every chip.
          const canDelete = !!onRemoveSegment;
          const handleDelete = canDelete
            ? (e: React.MouseEvent<HTMLElement>) => {
              // MuiChip already stops the onClick when onDelete fires, but
              // be explicit so a future refactor doesn't reopen the popover.
              e.stopPropagation();
              onRemoveSegment?.(axis, i);
            }
            : undefined;
          return (
            <React.Fragment key={`${axis}-seg-${i}`}>
              {i > 0 && (
                <ChevronRightIcon
                  fontSize="small"
                  aria-hidden
                  sx={{ color: "text.disabled" }}
                />
              )}
              <MuiChip
                size="medium"
                clickable
                onClick={(e) =>
                  onEditSegment(axis, i, e.currentTarget as HTMLElement)
                }
                aria-label={`Edit ${axis} segment ${i + 1} (${seg.kind})`}
                onDelete={handleDelete}
                deleteIcon={
                  <CancelIcon
                    aria-label={`Delete ${axis} segment ${i + 1}`}
                    sx={{
                      fontSize: 18,
                      color: colors.fg,
                      "&:hover": {
                        color: colors.fg,
                        opacity: 0.85,
                      },
                    }}
                  />
                }
                label={
                  <Stack
                    direction="row"
                    spacing={0.75}
                    alignItems="center"
                    sx={{ minWidth: 0 }}
                  >
                    <Box
                      component="span"
                      sx={{
                        fontWeight: 700,
                        fontSize: 11,
                        letterSpacing: 0.4,
                        opacity: 0.75,
                      }}
                    >
                      {i + 1}
                    </Box>
                    <Box
                      component="span"
                      sx={{
                        fontWeight: 600,
                        maxWidth: 180,
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                      title={
                        seg.kind === "pivot"
                          ? `${tone.label}: ${primary}`
                          : tone.label
                      }
                    >
                      {primary}
                    </Box>
                    <Box
                      component="span"
                      sx={{
                        fontVariantNumeric: "tabular-nums",
                        opacity: 0.85,
                      }}
                      aria-label={`${seg.positionCount} ${seg.positionCount === 1 ? "position" : "positions"
                        }`}
                    >
                      ×{seg.positionCount}
                    </Box>
                    {range && (
                      <Box
                        component="span"
                        sx={{
                          px: 0.5,
                          py: 0,
                          borderRadius: 0.5,
                          fontFamily: theme.typography.fontFamily,
                          fontSize: 11,
                          fontVariantNumeric: "tabular-nums",
                          backgroundColor: tone.filled
                            ? alpha(colors.fg, 0.16)
                            : alpha(theme.palette.text.primary, 0.06),
                          color: tone.filled ? colors.fg : "text.secondary",
                        }}
                        aria-label={`spans ${range}`}
                      >
                        {range}
                      </Box>
                    )}
                    {isDynamic && (
                      <Box
                        component="span"
                        sx={{
                          display: "inline-flex",
                          alignItems: "center",
                          gap: 0.25,
                          px: 0.5,
                          py: 0,
                          borderRadius: 0.5,
                          fontSize: 11,
                          fontWeight: 700,
                          backgroundColor: tone.filled
                            ? alpha(colors.fg, 0.18)
                            : alpha(theme.palette.text.primary, 0.08),
                          color: tone.filled ? colors.fg : "text.secondary",
                        }}
                        title="Grows dynamically until the configured terminator"
                      >
                        <AllInclusiveIcon sx={{ fontSize: 12 }} />
                        grows
                      </Box>
                    )}
                    <Box
                      component="span"
                      sx={{
                        position: "absolute",
                        width: 1,
                        height: 1,
                        overflow: "hidden",
                        clip: "rect(0 0 0 0)",
                        whiteSpace: "nowrap",
                      }}
                    >
                      {accessibleLabel}
                    </Box>
                  </Stack>
                }
                sx={{
                  height: 32,
                  borderRadius: 1,
                  border: "1.5px solid",
                  borderColor: colors.border,
                  backgroundColor: tone.filled ? colors.bg : "transparent",
                  color: tone.filled ? colors.fg : colors.fg,
                  ...(tone.palette === "grey" && !tone.filled
                    ? {
                      backgroundImage:
                        "repeating-linear-gradient(45deg, " +
                        `${alpha(theme.palette.text.primary, 0.18)} 0 4px,` +
                        " transparent 4px 8px)",
                    }
                    : null),
                  "& .MuiChip-label": {
                    pl: 1,
                    pr: handleDelete ? 0.5 : 1,
                    display: "flex",
                    alignItems: "center",
                  },
                  "& .MuiChip-deleteIcon": {
                    mr: 0.25,
                    ml: -0.25,
                    // MUI's default .MuiChip-deleteIcon colour is a muted
                    // rgba grey that washes out on our filled chips. Pin
                    // the delete icon to the chip's label colour explicitly
                    // so it inherits the same contrast the label has.
                    color: colors.fg,
                    "&:hover": {
                      color: colors.fg,
                      opacity: 0.85,
                    },
                  },
                  "&:hover": {
                    backgroundColor: tone.filled
                      ? alpha(colors.bg, 0.85)
                      : alpha(theme.palette.text.primary, 0.04),
                    borderColor: colors.border,
                  },
                  "&:focus-visible": {
                    outline: `2px solid ${theme.palette.primary.main}`,
                    outlineOffset: 2,
                  },
                }}
              />
            </React.Fragment>
          );
        })}

        <Box
          component="span"
          sx={{
            display: "inline-flex",
            alignItems: "center",
            gap: 0.25,
            pl: 0.5,
          }}
        >
          <Typography
            variant="caption"
            sx={{ color: "text.secondary", mr: 0.25 }}
          >
            Add:
          </Typography>
          {(["field", "pivot", "skip"] as const).map((kind) => (
            <Button
              key={kind}
              size="small"
              variant="text"
              disabled={!canAddSegment}
              onClick={() => onAddSegment(axis, kind)}
              aria-label={`Add ${axis} ${kind} segment`}
              title={addDisabledReason}
              sx={{ textTransform: "none", minWidth: 0, px: 0.75 }}
            >
              + {KIND_TONE[kind].label}
            </Button>
          ))}
        </Box>

        {onAddHeaderAxis && (
          <Button
            size="small"
            variant="outlined"
            onClick={() => onAddHeaderAxis(other)}
            aria-label={`Add ${other} header axis`}
          >
            + Add {other} axis
          </Button>
        )}
      </Box>
    </Stack>
  );
};

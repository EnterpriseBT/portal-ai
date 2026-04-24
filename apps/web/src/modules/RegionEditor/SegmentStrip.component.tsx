import React from "react";
import MuiChip from "@mui/material/Chip";
import { Box, Button, Stack, Typography } from "@portalai/core/ui";
import type { AxisMember, Segment } from "@portalai/core/contracts";

export interface SegmentStripUIProps {
  /** The axis this strip represents. Chip clicks, add-segment, and the
   *  optional add-header-axis emission all reference this axis. */
  axis: AxisMember;
  segments: Segment[];
  /** Optional uppercase section label (e.g. "Row axis"). When omitted a
   *  sensible default derived from `axis` is used. */
  axisLabel?: string;
  onEditSegment: (
    axis: AxisMember,
    segmentIndex: number,
    anchor: HTMLElement
  ) => void;
  onAddSegment: (axis: AxisMember) => void;
  /**
   * Provided only when the *other* axis isn't already a header axis — the
   * strip renders an "Add <other> header axis" button that forwards this
   * callback with the axis to promote. When `undefined`, the button is
   * hidden (refinement 1 forbids duplicate header axes).
   */
  onAddHeaderAxis?: (otherAxis: AxisMember) => void;
}

function segmentChipLabel(seg: Segment): string {
  if (seg.kind === "pivot") {
    return `${seg.axisName || "(unnamed)"} · ${seg.positionCount}`;
  }
  return `${seg.kind} · ${seg.positionCount}`;
}

function segmentChipColor(
  seg: Segment
): "default" | "primary" | "info" | "warning" {
  if (seg.kind === "pivot") return "primary";
  if (seg.kind === "field") return "info";
  return "default";
}

function otherAxis(axis: AxisMember): AxisMember {
  return axis === "row" ? "column" : "row";
}

export const SegmentStripUI: React.FC<SegmentStripUIProps> = ({
  axis,
  segments,
  axisLabel,
  onEditSegment,
  onAddSegment,
  onAddHeaderAxis,
}) => {
  const label = axisLabel ?? `${axis} axis`;
  const other = otherAxis(axis);

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
          gap: 0.5,
          alignItems: "center",
        }}
      >
        {segments.map((seg, i) => {
          const isDynamic = seg.kind === "pivot" && !!seg.dynamic;
          return (
            <MuiChip
              key={`${axis}-seg-${i}`}
              size="small"
              label={
                isDynamic
                  ? `${segmentChipLabel(seg)} · ∞`
                  : segmentChipLabel(seg)
              }
              color={segmentChipColor(seg)}
              variant={seg.kind === "skip" ? "outlined" : "filled"}
              onClick={(e) =>
                onEditSegment(axis, i, e.currentTarget as HTMLElement)
              }
              aria-label={`Edit ${axis} segment ${i + 1} (${seg.kind})`}
            />
          );
        })}

        <Button
          size="small"
          variant="text"
          onClick={() => onAddSegment(axis)}
          aria-label={`Add ${axis} segment`}
        >
          + Add segment
        </Button>

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

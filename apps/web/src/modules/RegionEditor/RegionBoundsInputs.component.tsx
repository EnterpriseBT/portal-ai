import React, { useEffect, useState } from "react";

import { Stack, TextInput } from "@portalai/core/ui";

import type { CellBounds, RegionDraft } from "./utils/region-editor.types";

export interface BoundsInputsUIProps {
  bounds: CellBounds;
  onUpdate: (updates: Partial<RegionDraft>) => void;
}

type BoundsField = "startRow" | "endRow" | "startCol" | "endCol";

const FIELD_LABELS: Record<BoundsField, string> = {
  startRow: "Start row",
  endRow: "End row",
  startCol: "Start col",
  endCol: "End col",
};

function toOneBased(value: number): string {
  return String(value + 1);
}

function fromOneBasedOrNull(input: string): number | null {
  const trimmed = input.trim();
  if (trimmed.length === 0) return null;
  const n = Number(trimmed);
  if (!Number.isInteger(n) || n < 1) return null;
  return n - 1;
}

/**
 * Manual bounds editor for the selected region. Lets users tighten or
 * grow the four edges by typing instead of dragging on the canvas —
 * critical when columns are added or removed in the source sheet
 * between a commit and a recommit, where the canvas drag-resize loses
 * accuracy on a sheet whose dimensions have shifted underneath the
 * persisted plan.
 *
 * Inputs are 1-based (matching the A1 notation users see everywhere
 * else); the draft model stores 0-based offsets so the conversion
 * happens at the input boundary. Local state mirrors the inputs so
 * the user can mid-edit a value (e.g. clear the field, type a new
 * number) without the parent forcing a re-render mid-keystroke; a
 * commit fires on blur or Enter, never on every keystroke.
 */
export const BoundsInputsUI: React.FC<BoundsInputsUIProps> = ({
  bounds,
  onUpdate,
}) => {
  const [draft, setDraft] = useState<Record<BoundsField, string>>({
    startRow: toOneBased(bounds.startRow),
    endRow: toOneBased(bounds.endRow),
    startCol: toOneBased(bounds.startCol),
    endCol: toOneBased(bounds.endCol),
  });

  // Re-sync local input state whenever the canonical bounds change
  // (canvas drag-resize, programmatic update, region switch). Without
  // this the inputs would freeze at whatever was last typed even
  // after the canvas overrides them.
  useEffect(() => {
    setDraft({
      startRow: toOneBased(bounds.startRow),
      endRow: toOneBased(bounds.endRow),
      startCol: toOneBased(bounds.startCol),
      endCol: toOneBased(bounds.endCol),
    });
  }, [bounds.startRow, bounds.endRow, bounds.startCol, bounds.endCol]);

  const commit = (field: BoundsField, raw: string): void => {
    const parsed = fromOneBasedOrNull(raw);
    if (parsed === null) {
      // Invalid input — snap the visible value back to the canonical
      // bounds so the user sees the rejection.
      setDraft((prev) => ({ ...prev, [field]: toOneBased(bounds[field]) }));
      return;
    }
    const next: CellBounds = { ...bounds, [field]: parsed };
    // Enforce start ≤ end on each axis. If the user typed a start
    // that's past the end (or vice versa), swap. This matches what
    // canvas drag-resize does when the user drags past the opposite
    // edge.
    if (next.startRow > next.endRow) {
      [next.startRow, next.endRow] = [next.endRow, next.startRow];
    }
    if (next.startCol > next.endCol) {
      [next.startCol, next.endCol] = [next.endCol, next.startCol];
    }
    onUpdate({ bounds: next });
  };

  const renderInput = (field: BoundsField) => (
    <TextInput
      label={FIELD_LABELS[field]}
      size="small"
      type="number"
      value={draft[field]}
      onChange={(e) =>
        setDraft((prev) => ({ ...prev, [field]: e.target.value }))
      }
      onBlur={(e) => commit(field, e.target.value)}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit(field, (e.target as HTMLInputElement).value);
        }
      }}
      slotProps={{ htmlInput: { min: 1, "aria-label": FIELD_LABELS[field] } }}
      sx={{ flex: 1, minWidth: 0 }}
    />
  );

  return (
    <Stack spacing={1}>
      <Stack direction="row" spacing={1}>
        {renderInput("startRow")}
        {renderInput("endRow")}
      </Stack>
      <Stack direction="row" spacing={1}>
        {renderInput("startCol")}
        {renderInput("endCol")}
      </Stack>
    </Stack>
  );
};

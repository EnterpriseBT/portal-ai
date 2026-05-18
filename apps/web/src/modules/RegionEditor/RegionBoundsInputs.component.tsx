import React, { useState } from "react";

import { Stack, TextInput } from "@portalai/core/ui";

import { colIndexToLetter, letterToColIndex } from "./utils/a1-notation.util";
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

const ROW_FIELDS: ReadonlySet<BoundsField> = new Set(["startRow", "endRow"]);

function isRowField(field: BoundsField): boolean {
  return ROW_FIELDS.has(field);
}

function toDisplay(field: BoundsField, value: number): string {
  return isRowField(field) ? String(value + 1) : colIndexToLetter(value);
}

function parseInput(field: BoundsField, raw: string): number | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  if (isRowField(field)) {
    const n = Number(trimmed);
    if (!Number.isInteger(n) || n < 1) return null;
    return n - 1;
  }
  // Column input: letters only (A, B, …, Z, AA, AB, …). The A1
  // notation the rest of the editor uses is letter-based, so the
  // input mirrors what the user sees in the heading + the canvas.
  if (!/^[A-Za-z]+$/.test(trimmed)) return null;
  return letterToColIndex(trimmed);
}

/**
 * Manual bounds editor for the selected region. Lets users tighten or
 * grow the four edges by typing instead of dragging on the canvas —
 * critical when columns are added or removed in the source sheet
 * between a commit and a recommit, where canvas drag-resize loses
 * accuracy on a sheet whose dimensions have shifted underneath the
 * persisted plan.
 *
 * Rows render as 1-based integers; columns render as A1 letters (A,
 * B, …, AA, AB, …) so the inputs match the spreadsheet convention
 * the heading + canvas already display. The draft model stores
 * 0-based offsets, so conversion happens at the input boundary.
 * Local state mirrors the inputs; commit fires on blur or Enter,
 * never on every keystroke.
 */
function buildInitialDraft(bounds: CellBounds): Record<BoundsField, string> {
  return {
    startRow: toDisplay("startRow", bounds.startRow),
    endRow: toDisplay("endRow", bounds.endRow),
    startCol: toDisplay("startCol", bounds.startCol),
    endCol: toDisplay("endCol", bounds.endCol),
  };
}

export const BoundsInputsUI: React.FC<BoundsInputsUIProps> = ({
  bounds,
  onUpdate,
}) => {
  const [draft, setDraft] = useState<Record<BoundsField, string>>(() =>
    buildInitialDraft(bounds)
  );
  // Derived-state-from-props pattern: re-sync the inputs whenever
  // the canonical bounds change (canvas drag-resize, programmatic
  // update, region switch). Tracking the last-seen bounds and
  // calling setState during render — instead of inside an effect —
  // avoids the cascading-render warning while still keeping the
  // local input state aligned with the prop. React deduplicates the
  // setState calls during the same render cycle, so this is cheap.
  const [lastBounds, setLastBounds] = useState<CellBounds>(bounds);
  if (
    bounds.startRow !== lastBounds.startRow ||
    bounds.endRow !== lastBounds.endRow ||
    bounds.startCol !== lastBounds.startCol ||
    bounds.endCol !== lastBounds.endCol
  ) {
    setLastBounds(bounds);
    setDraft(buildInitialDraft(bounds));
  }

  const commit = (field: BoundsField, raw: string): void => {
    const parsed = parseInput(field, raw);
    if (parsed === null) {
      // Invalid input — snap the visible value back to the canonical
      // bounds so the user sees the rejection.
      setDraft((prev) => ({ ...prev, [field]: toDisplay(field, bounds[field]) }));
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

  const renderInput = (field: BoundsField) => {
    const row = isRowField(field);
    return (
      <TextInput
        label={FIELD_LABELS[field]}
        size="small"
        type={row ? "number" : "text"}
        value={draft[field]}
        onChange={(e) => {
          // Force uppercase for column letter inputs as the user
          // types so "a3" can't sneak through and the display matches
          // the canvas heading style.
          const raw = e.target.value;
          const next = row ? raw : raw.toUpperCase();
          setDraft((prev) => ({ ...prev, [field]: next }));
        }}
        onBlur={(e) => commit(field, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            e.preventDefault();
            commit(field, (e.target as HTMLInputElement).value);
          }
        }}
        slotProps={{
          htmlInput: row
            ? { min: 1, "aria-label": FIELD_LABELS[field] }
            : {
                "aria-label": FIELD_LABELS[field],
                inputMode: "text",
                autoCapitalize: "characters",
                pattern: "[A-Za-z]+",
              },
        }}
        sx={{ flex: 1, minWidth: 0 }}
      />
    );
  };

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

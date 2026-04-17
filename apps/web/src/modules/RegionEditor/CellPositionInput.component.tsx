import React, { useMemo } from "react";
import { Select } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import { colIndexToLetter } from "./utils/a1-notation.util";

export interface CellPositionInputUIProps {
  axis: "column" | "row";
  /** 0-based index in the cross axis. */
  index: number;
  /** 0-based inclusive start of the valid cross-axis range. */
  startIndex: number;
  /** 0-based inclusive end of the valid cross-axis range. */
  endIndex: number;
  onChange: (nextIndex: number) => void;
}

function labelFor(axis: "column" | "row", index: number): string {
  return axis === "column" ? colIndexToLetter(index) : String(index + 1);
}

export const CellPositionInputUI: React.FC<CellPositionInputUIProps> = ({
  axis,
  index,
  startIndex,
  endIndex,
  onChange,
}) => {
  const options: SelectOption[] = useMemo(() => {
    const lo = Math.min(startIndex, endIndex);
    const hi = Math.max(startIndex, endIndex);
    const out: SelectOption[] = [];
    for (let i = lo; i <= hi; i += 1) {
      out.push({ value: String(i), label: labelFor(axis, i) });
    }
    return out;
  }, [axis, startIndex, endIndex]);

  return (
    <Select
      size="small"
      sx={{ width: 88 }}
      value={String(index)}
      onChange={(e) => {
        const next = parseInt(e.target.value as string, 10);
        if (!Number.isNaN(next) && next !== index) onChange(next);
      }}
      options={options}
      slotProps={{ htmlInput: { "aria-label": "Cell position" } }}
    />
  );
};

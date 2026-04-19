import React, { useMemo } from "react";
import { Select } from "@portalai/core/ui";
import type { SelectOption } from "@portalai/core/ui";

import { colIndexToLetter } from "./utils/a1-notation.util";

export interface CellPositionInputUIProps {
  axis: "column" | "row";
  /** 0-based index in the cross axis. `undefined` when no selection has been made. */
  index: number | undefined;
  /** 0-based inclusive start of the valid cross-axis range. */
  startIndex: number;
  /** 0-based inclusive end of the valid cross-axis range. */
  endIndex: number;
  onChange: (nextIndex: number) => void;
  error?: boolean;
  helperText?: string;
  label?: string;
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
  error,
  helperText,
  label,
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
      label={label}
      sx={{ minWidth: 104 }}
      value={index === undefined ? "" : String(index)}
      onChange={(e) => {
        const raw = e.target.value as string;
        if (raw === "") return;
        const next = parseInt(raw, 10);
        if (!Number.isNaN(next) && next !== index) onChange(next);
      }}
      options={options}
      placeholder={axis === "column" ? "Col" : "Row"}
      required
      error={error}
      helperText={helperText}
      slotProps={{
        htmlInput: {
          "aria-label": "Cell position",
          "aria-invalid": Boolean(error),
        },
      }}
    />
  );
};

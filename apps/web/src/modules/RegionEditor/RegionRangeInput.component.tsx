import React, { useState } from "react";

import { Button, Stack, TextInput } from "@portalai/core/ui";

import { parseRange } from "./utils/a1-notation.util";
import type { CellBounds } from "./utils/region-editor.types";

export interface RegionRangeInputUIProps {
  sheet: { rowCount: number; colCount: number };
  onCreate: (bounds: CellBounds) => void;
  disabled?: boolean;
}

/**
 * Creates a region from a typed A1 range (#795), the keyboard's way to do
 * what a drag on the sheet does. Enter in the field adds the region and
 * never submits the step's form; a bad range keeps focus in the field with
 * the parser's message.
 */
export const RegionRangeInputUI: React.FC<RegionRangeInputUIProps> = ({
  sheet,
  onCreate,
  disabled = false,
}) => {
  const [value, setValue] = useState("");
  const [error, setError] = useState<string | null>(null);

  const handleAdd = () => {
    const result = parseRange(value, sheet);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setError(null);
    setValue("");
    onCreate(result.bounds);
  };

  const handleKeyDown = (event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key !== "Enter") return;
    // The step around this field is a form whose Enter runs Interpret
    // (#789); here Enter means "add this region".
    event.preventDefault();
    event.stopPropagation();
    handleAdd();
  };

  return (
    <Stack direction="row" spacing={1} alignItems="flex-start">
      <TextInput
        label="Range"
        size="small"
        value={value}
        disabled={disabled}
        onChange={(e) => {
          setValue(e.target.value);
          if (error) setError(null);
        }}
        onKeyDown={handleKeyDown}
        error={!!error}
        helperText={error ?? "e.g. A1:D20 or A:D"}
        slotProps={{ htmlInput: { "aria-invalid": !!error } }}
      />
      <Button
        type="button"
        variant="outlined"
        onClick={handleAdd}
        disabled={disabled}
      >
        Add region
      </Button>
    </Stack>
  );
};

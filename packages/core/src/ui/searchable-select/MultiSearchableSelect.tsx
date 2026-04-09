import React from "react";
import MuiAutocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";

import type { SelectOption, SelectBaseProps } from "./types.js";

export interface MultiSearchableSelectProps extends SelectBaseProps {
  options: SelectOption[];
  value: string[];
  onChange: (values: string[]) => void;
}

export const MultiSearchableSelect: React.FC<MultiSearchableSelectProps> = ({
  options,
  value,
  onChange,
  label,
  placeholder,
  helperText,
  error,
  disabled,
  required,
  size = "small",
  fullWidth,
  inputRef,
}) => {
  const selectedOptions = value
    .map((v) => options.find((o) => String(o.value) === v))
    .filter((o): o is SelectOption => o != null);

  return (
    <MuiAutocomplete<SelectOption, true>
      multiple
      options={options}
      value={selectedOptions}
      onChange={(_event, selected) => onChange(selected.map((o) => String(o.value)))}
      isOptionEqualToValue={(option, val) => option.value === val.value}
      getOptionLabel={(option) => option.label}
      disabled={disabled}
      size={size}
      fullWidth={fullWidth}
      renderInput={(params) => (
        <TextField
          {...params}
          inputRef={inputRef}
          label={label}
          placeholder={placeholder}
          helperText={helperText}
          error={error}
          required={required}
        />
      )}
    />
  );
};

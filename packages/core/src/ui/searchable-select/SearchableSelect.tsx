import React from "react";
import MuiAutocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";

import type { SelectOption, SelectBaseProps } from "./types.js";

export interface SearchableSelectProps extends SelectBaseProps {
  options: SelectOption[];
  value: string | null;
  onChange: (value: string | null) => void;
}

export const SearchableSelect: React.FC<SearchableSelectProps> = ({
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
  const selectedOption = options.find((o) => o.value === value) ?? null;

  return (
    <MuiAutocomplete<SelectOption>
      options={options}
      value={selectedOption}
      onChange={(_event, option) => onChange(option ? String(option.value) : null)}
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

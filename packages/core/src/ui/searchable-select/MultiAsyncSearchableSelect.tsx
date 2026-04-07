import React, { useState, useEffect, useRef } from "react";
import MuiAutocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";

import type { SelectOption, SelectBaseProps } from "./types.js";

export interface MultiAsyncSearchableSelectProps extends SelectBaseProps {
  value: string[];
  onChange: (values: string[]) => void;
  onSearch: (query: string) => Promise<SelectOption[]>;
  debounceMs?: number;
}

export const MultiAsyncSearchableSelect: React.FC<MultiAsyncSearchableSelectProps> = ({
  onSearch,
  debounceMs = 300,
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
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<SelectOption[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep selected options in sync with external value prop
  useEffect(() => {
    setSelectedOptions((prev) => {
      if (value.length === 0) return [];
      // Keep only options that are still in the value array
      const kept = prev.filter((o) => value.includes(String(o.value)));
      return kept;
    });
  }, [value]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    if (!inputValue) {
      setOptions([]);
      return;
    }

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await onSearch(inputValue);
        setOptions(results);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, onSearch, debounceMs]);

  // Merge fetched options with selected options so selected chips always resolve
  const mergedOptions = [
    ...selectedOptions,
    ...options.filter((o) => !value.includes(String(o.value))),
  ];

  return (
    <MuiAutocomplete<SelectOption, true>
      multiple
      options={mergedOptions}
      value={selectedOptions}
      inputValue={inputValue}
      onInputChange={(_event, newInputValue, reason) => {
        if (reason !== "reset") setInputValue(newInputValue);
      }}
      onChange={(_event, selected) => {
        setSelectedOptions(selected);
        onChange(selected.map((o) => String(o.value)));
      }}
      isOptionEqualToValue={(option, val) => option.value === val.value}
      getOptionLabel={(option) => option.label}
      filterOptions={(x) => x}
      loading={loading}
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
          slotProps={{
            input: {
              ...params.InputProps,
              endAdornment: (
                <>
                  {loading ? <CircularProgress color="inherit" size={16} /> : null}
                  {params.InputProps.endAdornment}
                </>
              ),
            },
          }}
        />
      )}
    />
  );
};

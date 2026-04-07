import React, { useState, useEffect, useRef } from "react";
import MuiAutocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";

import type { SelectOption, SelectBaseProps } from "./types.js";

export interface AsyncSearchableSelectProps extends SelectBaseProps {
  value: string | null;
  onChange: (value: string | null) => void;
  onSearch: (query: string) => Promise<SelectOption[]>;
  debounceMs?: number;
  /** When true, allows arbitrary text input that is not in the dropdown options. */
  freeSolo?: boolean;
}

export const AsyncSearchableSelect: React.FC<AsyncSearchableSelectProps> = ({
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
  freeSolo = false,
}) => {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [inputValue, setInputValue] = useState(value ? String(value) : "");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Sync inputValue when value changes externally (e.g. parent state update
  // after a dropdown selection or programmatic change).
  const prevValueRef = useRef(value);
  useEffect(() => {
    if (value !== prevValueRef.current) {
      prevValueRef.current = value;
      setInputValue(value ? String(value) : "");
    }
  }, [value]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

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

  const selectedOption = options.find((o) => o.value === value) ?? null;

  // In freeSolo mode, debounce the free-text onChange so the parent doesn't
  // flicker between states on every keystroke.  Explicit dropdown selection
  // still fires immediately (bypasses the debounce).
  const freeSoloCommitRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const freeSoloCommitMs = debounceMs;

  if (freeSolo) {
    return (
      <MuiAutocomplete<SelectOption, false, false, true>
        freeSolo
        options={options}
        value={selectedOption ?? inputValue}
        inputValue={inputValue}
        onInputChange={(_event, newInputValue, reason) => {
          if (reason !== "reset") setInputValue(newInputValue);
          if (reason === "input") {
            // Debounce free-text commits
            if (freeSoloCommitRef.current) clearTimeout(freeSoloCommitRef.current);
            freeSoloCommitRef.current = setTimeout(() => {
              onChange(newInputValue || null);
            }, freeSoloCommitMs);
          }
        }}
        onChange={(_event, option) => {
          // Explicit dropdown selection — commit immediately, cancel pending debounce
          if (freeSoloCommitRef.current) clearTimeout(freeSoloCommitRef.current);
          if (typeof option === "string") {
            onChange(option || null);
          } else {
            onChange(option ? String(option.value) : null);
          }
        }}
        isOptionEqualToValue={(option, val) => option.value === val.value}
        getOptionLabel={(option) =>
          typeof option === "string" ? option : option.label
        }
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
  }

  return (
    <MuiAutocomplete<SelectOption>
      options={options}
      value={selectedOption}
      inputValue={inputValue}
      onInputChange={(_event, newInputValue, reason) => {
        if (reason !== "reset") setInputValue(newInputValue);
      }}
      onChange={(_event, option) => onChange(option ? String(option.value) : null)}
      isOptionEqualToValue={(option, val) => option.value === val.value}
      getOptionLabel={(option) => option.label}
      filterOptions={(x) => x}
      loading={loading}
      disabled={disabled}
      size={size}
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

import React, { useState, useEffect, useRef } from "react";
import MuiAutocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import Chip from "@mui/material/Chip";
import Stack from "@mui/material/Stack";

import type { SelectOption, SelectBaseProps } from "./types.js";

export interface AsyncSearchableSelectProps extends SelectBaseProps {
  value: string | null;
  onChange: (value: string | null) => void;
  onSearch: (query: string) => Promise<SelectOption[]>;
  debounceMs?: number;
  /**
   * Load the option that matches the current value (e.g. fetch by ID).
   * Called on mount when `value` is set. When provided, this overrides the
   * default `onSearch('')` initial load so the selected option's label can
   * be resolved even if a generic search wouldn't include it.
   */
  loadSelectedOption?: (value: string) => Promise<SelectOption | null>;
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
  loadSelectedOption,
}) => {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [selectedOption, setSelectedOption] = useState<SelectOption | null>(
    null
  );
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    let cancelled = false;

    if (value && loadSelectedOption) {
      // Load the specific selected option by value (e.g. by ID)
      setLoading(true);
      loadSelectedOption(value)
        .then((opt) => {
          if (cancelled) return;
          setSelectedOption(opt);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else {
      // Default: load initial options with empty search
      setLoading(true);
      onSearch("")
        .then((results) => {
          if (!cancelled) setOptions(results);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Debounced search on query change ---
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      try {
        setLoading(true);
        const results = await onSearch(searchQuery);
        setOptions(results);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, onSearch, debounceMs]);

  // --- Handlers ---
  const handleSelect = (
    _event: React.SyntheticEvent,
    option: SelectOption | null
  ) => {
    if (option) {
      onChange(String(option.value));
      setSelectedOption(option);
      setSearchQuery("");
    }
  };

  const handleClear = () => {
    onChange(null);
    setSelectedOption(null);
  };

  return (
    <Stack spacing={0.5} sx={{ width: fullWidth ? "100%" : undefined }}>
      {/* Selected value display */}
      {selectedOption && (
        <Chip
          label={selectedOption?.label ?? value}
          onDelete={disabled ? undefined : handleClear}
          size={size}
          color="primary"
          variant="outlined"
          sx={{ alignSelf: "flex-start", maxWidth: "100%" }}
        />
      )}

      {/* Search input */}
      <MuiAutocomplete<SelectOption>
        options={options}
        value={null}
        inputValue={searchQuery}
        onInputChange={(_event, newValue, reason) => {
          if (reason === "input") setSearchQuery(newValue);
        }}
        onChange={handleSelect}
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
                    {loading ? (
                      <CircularProgress color="inherit" size={16} />
                    ) : null}
                    {params.InputProps.endAdornment}
                  </>
                ),
              },
            }}
          />
        )}
      />
    </Stack>
  );
};

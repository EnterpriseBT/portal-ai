import React, { useState, useEffect, useRef, useCallback } from "react";
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
   * Fallback label to display for the selected value before options have
   * loaded (e.g. when the initial search hasn't returned yet).
   */
  displayLabel?: string;
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
  displayLabel,
  loadSelectedOption,
}) => {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [searchQuery, setSearchQuery] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => { mountedRef.current = false; };
  }, []);

  // --- Initial load on mount ---
  const initialLoadDone = useRef(false);
  useEffect(() => {
    if (initialLoadDone.current) return;
    initialLoadDone.current = true;

    let cancelled = false;

    if (value && loadSelectedOption) {
      // Load the specific selected option by value (e.g. by ID)
      setLoading(true);
      loadSelectedOption(value).then((opt) => {
        if (cancelled) return;
        if (opt) {
          setOptions((prev) => {
            // Merge without duplicating
            if (prev.some((o) => o.value === opt.value)) return prev;
            return [opt, ...prev];
          });
        }
        // Also do a default search to populate the dropdown
        return onSearch("");
      }).then((results) => {
        if (cancelled || !results) return;
        setOptions((prev) => {
          const existing = new Set(prev.map((o) => o.value));
          return [...prev, ...results.filter((r) => !existing.has(r.value))];
        });
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    } else {
      // Default: load initial options with empty search
      setLoading(true);
      onSearch("").then((results) => {
        if (!cancelled) setOptions(results);
      }).finally(() => {
        if (!cancelled) setLoading(false);
      });
    }

    return () => { cancelled = true; };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Debounced search on query change ---
  useEffect(() => {
    // Skip on mount — initial load handles it
    if (!initialLoadDone.current) return;

    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await onSearch(searchQuery);
        if (mountedRef.current) setOptions(results);
      } finally {
        if (mountedRef.current) setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [searchQuery, onSearch, debounceMs]);

  // --- Resolve the label for the selected value ---
  const resolveSelectedLabel = useCallback((): string | null => {
    if (!value) return null;
    const match = options.find((o) => String(o.value) === value);
    if (match) return match.label;
    return displayLabel ?? null;
  }, [value, options, displayLabel]);

  const selectedLabel = resolveSelectedLabel();

  // --- Handlers ---
  const handleSelect = (_event: React.SyntheticEvent, option: SelectOption | null) => {
    if (option) {
      onChange(String(option.value));
      setSearchQuery("");
    }
  };

  const handleClear = () => {
    onChange(null);
  };

  return (
    <Stack spacing={0.5} sx={{ width: fullWidth ? "100%" : undefined }}>
      {/* Selected value display */}
      {value && (
        <Chip
          label={selectedLabel ?? value}
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
                    {loading ? <CircularProgress color="inherit" size={16} /> : null}
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

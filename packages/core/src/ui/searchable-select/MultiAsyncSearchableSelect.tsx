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
  /**
   * Called when `onSearch` rejects. Options are cleared on rejection
   * whether or not this is supplied. See `AsyncSearchableSelect` for why
   * it's optional.
   */
  onSearchError?: (error: unknown) => void;
}

export const MultiAsyncSearchableSelect: React.FC<
  MultiAsyncSearchableSelectProps
> = ({
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
  onSearchError,
}) => {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [selectedOptions, setSelectedOptions] = useState<SelectOption[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep selected options in sync with the external value prop. Every id in
  // `value` must render a chip — including a *seeded* value (editing an existing
  // policy, or a read-only system policy) whose ids the user never picked. Since
  // this variant has no `options` prop, resolve each id to a *labeled* option
  // (label !== id), preferring an already-selected option over a freshly-loaded
  // one so a user-picked chip label stays stable across a later search that
  // returns the same id relabeled; a raw-id chip (label === id) is only a
  // placeholder, so it is upgraded as soon as any search resolves a real label.
  // Fall back to the raw id last so a seeded value is never an empty picker
  // (#630). Re-runs when `options` load so a seeded id upgrades to its label.
  useEffect(() => {
    setSelectedOptions((prev) => {
      if (value.length === 0) return [];
      const wanted = new Set(value);
      const labeled = new Map<string, SelectOption>();
      const anyOption = new Map<string, SelectOption>();
      for (const o of [...prev, ...options]) {
        const v = String(o.value);
        if (!wanted.has(v)) continue;
        if (o.label !== v && !labeled.has(v)) labeled.set(v, o);
        if (!anyOption.has(v)) anyOption.set(v, o);
      }
      return value.map(
        (v) => labeled.get(v) ?? anyOption.get(v) ?? { value: v, label: v }
      );
    });
  }, [value, options]);

  // Initial load on mount
  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    onSearch("")
      .then((results) => {
        if (!cancelled) setOptions(results);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setOptions([]);
        onSearchError?.(err);
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search on input change
  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(async () => {
      setLoading(true);
      try {
        const results = await onSearch(inputValue);
        setOptions(results);
      } catch (err: unknown) {
        // Drop the previous results: they no longer describe this query.
        setOptions([]);
        onSearchError?.(err);
      } finally {
        setLoading(false);
      }
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, onSearch, debounceMs, onSearchError]);

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
  );
};

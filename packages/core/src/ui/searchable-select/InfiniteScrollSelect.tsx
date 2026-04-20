import React, { useState, useEffect, useRef, useCallback } from "react";
import MuiAutocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";

import type {
  SelectOption,
  SelectBaseProps,
  FetchPageParams,
  FetchPageResult,
} from "./types.js";
import {
  InfiniteListboxComponent,
  SentinelRefContext,
  InfiniteLoadingContext,
  ScrollTopRef,
} from "./InfiniteListbox.js";

export interface InfiniteScrollSelectProps extends SelectBaseProps {
  value: string | null;
  onChange: (value: string | null) => void;
  fetchPage: (params: FetchPageParams) => Promise<FetchPageResult>;
  pageSize?: number;
  debounceMs?: number;
}

export const InfiniteScrollSelect: React.FC<InfiniteScrollSelectProps> = ({
  fetchPage,
  pageSize = 20,
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
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);

  const searchRef = useRef("");
  const pageRef = useRef(0);
  const hasMoreRef = useRef(true);
  const loadingRef = useRef(false);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const scrollTopRef = useRef(0);
  const initialFetchDone = useRef(false);

  const doFetch = useCallback(
    async (search: string, pg: number, reset: boolean) => {
      if (loadingRef.current) return;
      loadingRef.current = true;
      setLoading(true);
      try {
        const result = await fetchPage({ search, page: pg, pageSize });
        hasMoreRef.current = result.hasMore;
        setOptions((prev) =>
          reset ? result.options : [...prev, ...result.options]
        );
        pageRef.current = pg;
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [fetchPage, pageSize]
  );

  useEffect(() => {
    if (open && !initialFetchDone.current) {
      initialFetchDone.current = true;
      doFetch("", 0, true);
    }
  }, [open, doFetch]);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);

    debounceRef.current = setTimeout(() => {
      if (searchRef.current === inputValue) return;
      searchRef.current = inputValue;
      setOptions([]);
      pageRef.current = 0;
      hasMoreRef.current = true;
      scrollTopRef.current = 0;
      initialFetchDone.current = true;
      doFetch(inputValue, 0, true);
    }, debounceMs);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [inputValue, debounceMs, doFetch]);

  const setSentinelRef = useCallback(
    (el: HTMLDivElement | null) => {
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
      if (!el) return;

      observerRef.current = new IntersectionObserver(
        (entries) => {
          const entry = entries[0];
          if (
            entry?.isIntersecting &&
            hasMoreRef.current &&
            !loadingRef.current
          ) {
            const nextPage = pageRef.current + 1;
            doFetch(searchRef.current, nextPage, false);
          }
        },
        { threshold: 0.1 }
      );
      observerRef.current.observe(el);
    },
    [doFetch]
  );

  useEffect(() => {
    return () => {
      if (observerRef.current) observerRef.current.disconnect();
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, []);

  const selectedOption = options.find((o) => o.value === value) ?? null;

  return (
    <ScrollTopRef.Provider value={scrollTopRef}>
      <SentinelRefContext.Provider value={setSentinelRef}>
        <InfiniteLoadingContext.Provider value={loading}>
          <MuiAutocomplete<SelectOption>
            options={options}
            value={selectedOption}
            inputValue={inputValue}
            open={open}
            onOpen={() => setOpen(true)}
            onClose={() => setOpen(false)}
            onInputChange={(_event, newInputValue, reason) => {
              if (reason !== "reset") setInputValue(newInputValue);
            }}
            onChange={(_event, option) =>
              onChange(option ? String(option.value) : null)
            }
            isOptionEqualToValue={(option, val) => option.value === val.value}
            getOptionLabel={(option) => option.label}
            filterOptions={(x) => x}
            disabled={disabled}
            size={size}
            fullWidth={fullWidth}
            ListboxComponent={InfiniteListboxComponent}
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
        </InfiniteLoadingContext.Provider>
      </SentinelRefContext.Provider>
    </ScrollTopRef.Provider>
  );
};

import React, { useState, useEffect, useRef, useCallback, useContext } from "react";
import MuiAutocomplete from "@mui/material/Autocomplete";
import TextField from "@mui/material/TextField";
import CircularProgress from "@mui/material/CircularProgress";
import Box from "@mui/material/Box";

import type { SelectOption } from "./Select.js";

export type { SelectOption };

// ── Shared base props ─────────────────────────────────────────────────────────

interface SearchableSelectBaseProps {
  value: string | null;
  onChange: (value: string | null) => void;
  label?: string;
  placeholder?: string;
  helperText?: string;
  error?: boolean;
  disabled?: boolean;
  required?: boolean;
  size?: "small" | "medium";
}

// ── SearchableSelect (synchronous) ────────────────────────────────────────────

export interface SearchableSelectProps extends SearchableSelectBaseProps {
  options: SelectOption[];
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
      renderInput={(params) => (
        <TextField
          {...params}
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

// ── AsyncSearchableSelect (search-on-type) ────────────────────────────────────

export interface AsyncSearchableSelectProps extends SearchableSelectBaseProps {
  onSearch: (query: string) => Promise<SelectOption[]>;
  debounceMs?: number;
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
}) => {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [inputValue, setInputValue] = useState("");
  const [loading, setLoading] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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

  const selectedOption = options.find((o) => o.value === value) ?? null;

  return (
    <MuiAutocomplete<SelectOption>
      options={options}
      value={selectedOption}
      inputValue={inputValue}
      onInputChange={(_event, newInputValue) => setInputValue(newInputValue)}
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

// ── InfiniteScrollSelect (search + paginated scroll) ──────────────────────────

export interface FetchPageParams {
  search: string;
  page: number;
  pageSize: number;
}

export interface FetchPageResult {
  options: SelectOption[];
  hasMore: boolean;
}

export interface InfiniteScrollSelectProps extends SearchableSelectBaseProps {
  fetchPage: (params: FetchPageParams) => Promise<FetchPageResult>;
  pageSize?: number;
  debounceMs?: number;
}

/** Context used to pass the sentinel registration callback to the listbox. */
const SentinelRefContext = React.createContext<
  ((el: HTMLDivElement | null) => void) | null
>(null);

/** Context used to pass the loading state to the listbox. */
const InfiniteLoadingContext = React.createContext(false);

/** Context used to pass a stable ref that tracks the listbox scroll position. */
const ScrollTopRef = React.createContext<React.MutableRefObject<number> | null>(null);

const InfiniteListboxComponent = React.forwardRef<
  HTMLUListElement,
  React.HTMLAttributes<HTMLElement>
>(({ children, ...props }, ref) => {
  const setSentinelRef = useContext(SentinelRefContext);
  const loading = useContext(InfiniteLoadingContext);
  const scrollTopRef = useContext(ScrollTopRef);
  const innerRef = useRef<HTMLUListElement | null>(null);

  // Restore scroll position after each render (options append causes re-mount)
  useEffect(() => {
    if (innerRef.current && scrollTopRef) {
      innerRef.current.scrollTop = scrollTopRef.current;
    }
  });

  const handleScroll = useCallback(() => {
    if (innerRef.current && scrollTopRef) {
      scrollTopRef.current = innerRef.current.scrollTop;
    }
  }, [scrollTopRef]);

  const setRefs = useCallback(
    (el: HTMLUListElement | null) => {
      innerRef.current = el;
      if (typeof ref === "function") ref(el);
      else if (ref) (ref as React.MutableRefObject<HTMLUListElement | null>).current = el;
    },
    [ref]
  );

  return (
    <ul ref={setRefs} {...props} onScroll={handleScroll}>
      {children}
      {loading && (
        <Box
          component="li"
          sx={{ display: "flex", justifyContent: "center", py: 1 }}
          aria-label="loading"
        >
          <CircularProgress size={20} />
        </Box>
      )}
      <div
        ref={setSentinelRef}
        data-testid="infinite-scroll-sentinel"
        style={{ height: 1 }}
      />
    </ul>
  );
});

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
        setOptions((prev) => (reset ? result.options : [...prev, ...result.options]));
        pageRef.current = pg;
      } finally {
        loadingRef.current = false;
        setLoading(false);
      }
    },
    [fetchPage, pageSize]
  );

  // Trigger initial fetch when opened with no options loaded
  useEffect(() => {
    if (open && !initialFetchDone.current) {
      initialFetchDone.current = true;
      doFetch("", 0, true);
    }
  }, [open, doFetch]);

  // Debounce search input changes
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

  // Set up IntersectionObserver on the sentinel element
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
          if (entry?.isIntersecting && hasMoreRef.current && !loadingRef.current) {
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

  // Cleanup observer on unmount
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
            onInputChange={(_event, newInputValue) => setInputValue(newInputValue)}
            onChange={(_event, option) => onChange(option ? String(option.value) : null)}
            isOptionEqualToValue={(option, val) => option.value === val.value}
            getOptionLabel={(option) => option.label}
            filterOptions={(x) => x}
            disabled={disabled}
            size={size}
            ListboxComponent={InfiniteListboxComponent}
            renderInput={(params) => (
              <TextField
                {...params}
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

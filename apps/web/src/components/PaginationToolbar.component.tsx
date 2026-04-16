import React from "react";
import Box from "@mui/material/Box";
import TextField from "@mui/material/TextField";
import InputAdornment from "@mui/material/InputAdornment";
import Popover from "@mui/material/Popover";
import FormControlLabel from "@mui/material/FormControlLabel";
import Chip from "@mui/material/Chip";
import Badge from "@mui/material/Badge";
import Radio from "@mui/material/Radio";
import RadioGroup from "@mui/material/RadioGroup";
import Switch from "@mui/material/Switch";
import Divider from "@mui/material/Divider";
import SearchIcon from "@mui/icons-material/Search";
import FilterListIcon from "@mui/icons-material/FilterList";
import TuneIcon from "@mui/icons-material/Tune";
import SortIcon from "@mui/icons-material/Sort";
import ArrowUpwardIcon from "@mui/icons-material/ArrowUpward";
import ArrowDownwardIcon from "@mui/icons-material/ArrowDownward";
import CloseIcon from "@mui/icons-material/Close";
import FirstPageIcon from "@mui/icons-material/FirstPage";
import LastPageIcon from "@mui/icons-material/LastPage";
import ChevronLeftIcon from "@mui/icons-material/ChevronLeft";
import ChevronRightIcon from "@mui/icons-material/ChevronRight";
import IconButton from "@mui/material/IconButton";
import Select from "@mui/material/Select";
import MenuItem from "@mui/material/MenuItem";
import {
  Button,
  Typography,
  SearchableSelect,
  AsyncSearchableSelect,
  InfiniteScrollSelect,
  MultiSearchableSelect,
  MultiAsyncSearchableSelect,
  MultiInfiniteScrollSelect,
} from "@portalai/core/ui";
import type { FetchPageParams, FetchPageResult, SelectOption } from "@portalai/core/ui";

import type { FilterExpression, ResolvedColumn } from "@portalai/core/contracts";
import {
  serializeFilterExpression,
  isFilterExpressionEmpty,
  countActiveConditions,
  createEmptyExpression,
  collectConditions,
  removeConditionByIndex,
  getOperatorLabel,
} from "../utils/advanced-filter-builder.util";
const AdvancedFilterBuilderLazy = React.lazy(
  () => import("./AdvancedFilterBuilder.component").then((m) => ({ default: m.AdvancedFilterBuilder }))
);

// --- Configuration Types ---

export interface FilterOption {
  label: string;
  value: string;
}

interface BaseFilterConfig {
  field: string;
  label: string;
  defaultValue?: string[];
}

export interface SelectFilterConfig extends BaseFilterConfig {
  type: "select";
  options: FilterOption[];
}

export interface BooleanFilterConfig extends BaseFilterConfig {
  type: "boolean";
}

export interface NumberFilterConfig extends BaseFilterConfig {
  type: "number";
  min?: number;
  max?: number;
  placeholder?: string;
}

export interface TextFilterConfig extends BaseFilterConfig {
  type: "text";
  placeholder?: string;
}

export interface SearchableSelectFilterConfig extends BaseFilterConfig {
  type: "searchable-select";
  /** Static options for client-side filtering. */
  options?: FilterOption[];
  /** Async search callback. When provided, renders an AsyncSearchableSelect. */
  onSearch?: (query: string) => Promise<SelectOption[]>;
  /** Paginated fetch callback. When provided, renders an InfiniteScrollSelect. */
  fetchPage?: (params: FetchPageParams) => Promise<FetchPageResult>;
  /** Map of value → label for resolving display labels (used with async/paginated modes). */
  labelMap?: Record<string, string>;
}

export interface MultiSelectFilterConfig extends BaseFilterConfig {
  type: "multi-select";
  /** Static options for client-side filtering. Used when the full list is available upfront. */
  options?: FilterOption[];
  /** Async search callback. When provided, renders a MultiAsyncSearchableSelect. */
  onSearch?: (query: string) => Promise<SelectOption[]>;
  /** Paginated fetch callback for large option sets. When provided, renders a MultiInfiniteScrollSelect. */
  fetchPage?: (params: FetchPageParams) => Promise<FetchPageResult>;
  /** Map of value → label for resolving display labels of selected values (used with async/paginated modes). */
  labelMap?: Record<string, string>;
}

export type FilterConfig =
  | SelectFilterConfig
  | BooleanFilterConfig
  | NumberFilterConfig
  | TextFilterConfig
  | SearchableSelectFilterConfig
  | MultiSelectFilterConfig;

export interface SortFieldConfig {
  field: string;
  label: string;
}

// --- Hook ---

export interface PaginationPersistedState {
  search: string;
  filters: Record<string, string[]>;
  sortBy: string;
  sortOrder: "asc" | "desc";
  limit: number;
  advancedFilters?: FilterExpression;
}

export interface UsePaginationConfig {
  filters?: FilterConfig[];
  sortFields?: SortFieldConfig[];
  defaultSortBy?: string;
  defaultSortOrder?: "asc" | "desc";
  limit?: number;
  limitOptions?: number[];
  /** Pre-loaded state (e.g. from storage). Takes precedence over defaults. */
  initialValue?: PaginationPersistedState;
  /** Called whenever persisted state changes — use to save to storage. */
  onPersist?: (state: PaginationPersistedState) => void;
  /** Column definitions for the advanced filter builder. When provided, the builder UI is shown. */
  columnDefinitions?: ResolvedColumn[];
}

export interface UsePaginationReturn {
  search: string;
  filters: Record<string, string[]>;
  advancedFilters: FilterExpression;
  sortBy: string;
  sortOrder: "asc" | "desc";
  offset: number;
  limit: number;
  total: number;
  setSearch: (value: string) => void;
  setFilter: (field: string, values: string[]) => void;
  setFilterValue: (field: string, value: string) => void;
  setAdvancedFilters: (expr: FilterExpression) => void;
  clearAdvancedFilters: () => void;
  setSortBy: (field: string) => void;
  setSortOrder: (order: "asc" | "desc") => void;
  toggleSortOrder: () => void;
  setOffset: (offset: number) => void;
  setLimit: (limit: number) => void;
  setTotal: (total: number) => void;
  queryParams: Record<string, string | number | boolean | undefined>;
  toolbarProps: PaginationToolbarProps;
}

export function usePagination(
  config: UsePaginationConfig = {}
): UsePaginationReturn {
  const {
    filters: filterConfigs = [],
    sortFields = [],
    defaultSortBy = "created",
    defaultSortOrder = "asc",
    limit: defaultLimit = 10,
    limitOptions = [5, 10, 20, 50, 100],
    initialValue,
    onPersist,
    columnDefinitions = [],
  } = config;

  const [search, setSearchRaw] = React.useState(initialValue?.search ?? "");
  const [filters, setFilters] = React.useState<Record<string, string[]>>(() => {
    if (initialValue) return initialValue.filters;
    const initial: Record<string, string[]> = {};
    for (const fc of filterConfigs) {
      if (fc.defaultValue && fc.defaultValue.length > 0) {
        initial[fc.field] = fc.defaultValue;
      }
    }
    return initial;
  });
  const [sortBy, setSortByRaw] = React.useState(
    initialValue?.sortBy ?? defaultSortBy
  );
  const [sortOrder, setSortOrderRaw] = React.useState<"asc" | "desc">(
    initialValue?.sortOrder ?? defaultSortOrder
  );
  const [offset, setOffset] = React.useState(0);
  const [limit, setLimitRaw] = React.useState(
    initialValue?.limit ?? defaultLimit
  );
  const [total, setTotal] = React.useState(0);
  const [advancedFilters, setAdvancedFiltersRaw] = React.useState<FilterExpression>(
    () => initialValue?.advancedFilters ?? createEmptyExpression()
  );

  const persistRef = React.useRef({ search, filters, sortBy, sortOrder, limit, advancedFilters });

  const persist = React.useCallback(
    (patch: Partial<PaginationPersistedState>) => {
      const next = { ...persistRef.current, ...patch };
      persistRef.current = next;
      onPersist?.(next);
    },
    [onPersist]
  );

  const resetOffset = React.useCallback(() => setOffset(0), []);

  const setSearch = React.useCallback(
    (value: string) => {
      setSearchRaw(value);
      persist({ search: value });
      resetOffset();
    },
    [resetOffset, persist]
  );

  const setFilter = React.useCallback(
    (field: string, values: string[]) => {
      setFilters((prev) => {
        const next = { ...prev, [field]: values };
        persist({ filters: next });
        return next;
      });
      resetOffset();
    },
    [resetOffset, persist]
  );

  const setSortBy = React.useCallback(
    (field: string) => {
      setSortByRaw(field);
      persist({ sortBy: field });
    },
    [persist]
  );

  const setSortOrder = React.useCallback(
    (order: "asc" | "desc") => {
      setSortOrderRaw(order);
      persist({ sortOrder: order });
    },
    [persist]
  );

  const toggleSortOrder = React.useCallback(() => {
    setSortOrderRaw((prev) => {
      const next = prev === "asc" ? "desc" : "asc";
      persist({ sortOrder: next });
      return next;
    });
  }, [persist]);

  const setLimit = React.useCallback(
    (value: number) => {
      setLimitRaw(value);
      persist({ limit: value });
      resetOffset();
    },
    [resetOffset, persist]
  );

  const currentPage = Math.floor(offset / limit) + 1;
  const totalPages = Math.max(1, Math.ceil(total / limit));

  const goToFirst = React.useCallback(() => setOffset(0), []);
  const goToPrev = React.useCallback(
    () => setOffset((prev) => Math.max(0, prev - limit)),
    [limit]
  );
  const goToNext = React.useCallback(
    () => setOffset((prev) => Math.min((totalPages - 1) * limit, prev + limit)),
    [limit, totalPages]
  );
  const goToLast = React.useCallback(
    () => setOffset((totalPages - 1) * limit),
    [limit, totalPages]
  );

  // Build flat query params for the API
  const queryParams = React.useMemo(() => {
    const params: Record<string, string | number | boolean | undefined> = {
      limit,
      offset,
      sortBy,
      sortOrder,
    };
    if (search) params.search = search;
    for (const [field, values] of Object.entries(filters)) {
      if (values.length === 0) continue;
      const config = filterConfigs.find((c) => c.field === field);
      if (config?.type === "boolean") {
        params[field] =
          values[0] === "true"
            ? true
            : values[0] === "false"
              ? false
              : undefined;
      } else if (config?.type === "number") {
        params[field] = Number(values[0]);
      } else if (config?.type === "multi-select") {
        params[field] = values.join(",");
      } else {
        params[field] = values[0];
      }
    }
    if (!isFilterExpressionEmpty(advancedFilters)) {
      params.filters = serializeFilterExpression(advancedFilters);
    }
    return params;
  }, [search, filters, filterConfigs, advancedFilters, sortBy, sortOrder, offset, limit]);

  const activeFilterCount = Object.values(filters).reduce(
    (count, values) => count + values.length,
    0
  );

  const setFilterValue = React.useCallback(
    (field: string, value: string) => {
      setFilters((prev) => {
        const next = { ...prev, [field]: value ? [value] : [] };
        persist({ filters: next });
        return next;
      });
      resetOffset();
    },
    [resetOffset, persist]
  );

  const setAdvancedFilters = React.useCallback(
    (expr: FilterExpression) => {
      setAdvancedFiltersRaw(expr);
      persist({ advancedFilters: expr });
      resetOffset();
    },
    [resetOffset, persist]
  );

  const clearAdvancedFilters = React.useCallback(() => {
    const empty = createEmptyExpression();
    setAdvancedFiltersRaw(empty);
    persist({ advancedFilters: empty });
    resetOffset();
  }, [resetOffset, persist]);

  const advancedFilterConditionCount = countActiveConditions(advancedFilters);

  const toolbarProps: PaginationToolbarProps = {
    search,
    onSearchChange: setSearch,
    filterConfigs,
    filters,
    onFilterValueChange: setFilterValue,
    onFilterChange: setFilter,
    activeFilterCount,
    sortFields,
    sortBy,
    onSortByChange: setSortBy,
    sortOrder,
    onSortOrderChange: setSortOrder,
    offset,
    limit,
    limitOptions,
    onLimitChange: setLimit,
    total,
    currentPage,
    totalPages,
    onFirst: goToFirst,
    onPrev: goToPrev,
    onNext: goToNext,
    onLast: goToLast,
    advancedFilters,
    onAdvancedFiltersChange: setAdvancedFilters,
    onAdvancedFiltersClear: clearAdvancedFilters,
    advancedFilterConditionCount,
    columnDefinitions,
  };

  return {
    search,
    filters,
    advancedFilters,
    sortBy,
    sortOrder,
    offset,
    limit,
    total,
    setSearch,
    setFilter,
    setFilterValue,
    setAdvancedFilters,
    clearAdvancedFilters,
    setSortBy,
    setSortOrder,
    toggleSortOrder,
    setOffset,
    setLimit,
    setTotal,
    queryParams,
    toolbarProps,
  };
}

// --- Component ---

export interface PaginationToolbarProps {
  search: string;
  onSearchChange: (value: string) => void;
  filterConfigs: FilterConfig[];
  filters: Record<string, string[]>;
  onFilterValueChange: (field: string, value: string) => void;
  /** Set the full values array for a filter field (used by multi-select). */
  onFilterChange: (field: string, values: string[]) => void;
  activeFilterCount: number;
  sortFields: SortFieldConfig[];
  sortBy: string;
  onSortByChange: (field: string) => void;
  sortOrder: "asc" | "desc";
  onSortOrderChange: (order: "asc" | "desc") => void;
  offset: number;
  limit: number;
  limitOptions: number[];
  onLimitChange: (limit: number) => void;
  total: number;
  currentPage: number;
  totalPages: number;
  onFirst: () => void;
  onPrev: () => void;
  onNext: () => void;
  onLast: () => void;
  /** Advanced filter expression state. */
  advancedFilters?: FilterExpression;
  /** Called when advanced filters change. */
  onAdvancedFiltersChange?: (expr: FilterExpression) => void;
  /** Clear all advanced filters. */
  onAdvancedFiltersClear?: () => void;
  /** Number of active advanced filter conditions. */
  advancedFilterConditionCount?: number;
  /** Column definitions for the advanced filter builder. */
  columnDefinitions?: ResolvedColumn[];
}

export const PaginationToolbar = React.forwardRef<
  HTMLDivElement,
  PaginationToolbarProps
>(
  (
    {
      search,
      onSearchChange,
      filterConfigs,
      filters,
      onFilterValueChange,
      onFilterChange,
      activeFilterCount,
      sortFields,
      sortBy,
      onSortByChange,
      sortOrder,
      onSortOrderChange,
      limit,
      limitOptions,
      onLimitChange,
      total,
      currentPage,
      totalPages,
      onFirst,
      onPrev,
      onNext,
      onLast,
      advancedFilters,
      onAdvancedFiltersChange,
      onAdvancedFiltersClear,
      advancedFilterConditionCount = 0,
      columnDefinitions,
    },
    ref
  ) => {
    const [filterAnchor, setFilterAnchor] = React.useState<HTMLElement | null>(
      null
    );
    const [sortAnchor, setSortAnchor] = React.useState<HTMLElement | null>(
      null
    );
    const [advFilterAnchor, setAdvFilterAnchor] = React.useState<HTMLElement | null>(
      null
    );

    const filterOpen = Boolean(filterAnchor);
    const sortOpen = Boolean(sortAnchor);
    const advFilterOpen = Boolean(advFilterAnchor);

    const showAdvancedFilters = columnDefinitions && columnDefinitions.length > 0;

    return (
      <Box ref={ref} sx={{ display: "flex", flexDirection: "column", gap: 1 }}>
        <Box
          sx={{
            display: "flex",
            alignItems: "center",
            gap: 1,
            flexWrap: "wrap",
          }}
        >
          {/* Search */}
          <TextField
            autoFocus
            size="small"
            placeholder="Search..."
            value={search}
            onChange={(e) => onSearchChange(e.target.value)}
            slotProps={{
              input: {
                startAdornment: (
                  <InputAdornment position="start">
                    <SearchIcon fontSize="small" />
                  </InputAdornment>
                ),
                endAdornment: search ? (
                  <InputAdornment position="end">
                    <IconButton
                      size="small"
                      onClick={() => onSearchChange("")}
                      edge="end"
                      aria-label="Clear search"
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
            sx={{ minWidth: { xs: 120, sm: 200 }, flex: { xs: 1, sm: "unset" } }}
          />

          {/* Filter Button */}
          {filterConfigs.length > 0 && (
            <>
              <Badge badgeContent={activeFilterCount} color="primary">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<FilterListIcon />}
                  onClick={(e) => setFilterAnchor(e.currentTarget)}
                >
                  Filter
                </Button>
              </Badge>

              <Popover
                open={filterOpen}
                anchorEl={filterAnchor}
                onClose={() => setFilterAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                transformOrigin={{ vertical: "top", horizontal: "left" }}
              >
                <Box sx={{ p: 2, minWidth: 220 }}>
                  {filterConfigs.map((config, idx) => (
                    <Box key={config.field}>
                      {idx > 0 && <Divider sx={{ my: 1 }} />}
                      <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                        {config.label}
                      </Typography>

                      {config.type === "select" && (
                        <RadioGroup
                          value={(filters[config.field] ?? [])[0] ?? ""}
                          onChange={(e) =>
                            onFilterValueChange(config.field, e.target.value)
                          }
                        >
                          {config.options.map((option) => (
                            <FormControlLabel
                              key={option.value}
                              value={option.value}
                              control={<Radio size="small" />}
                              label={option.label}
                            />
                          ))}
                        </RadioGroup>
                      )}

                      {config.type === "boolean" && (
                        <FormControlLabel
                          control={
                            <Switch
                              size="small"
                              checked={
                                (filters[config.field] ?? [])[0] === "true"
                              }
                              onChange={(e) =>
                                onFilterValueChange(
                                  config.field,
                                  e.target.checked ? "true" : "false"
                                )
                              }
                            />
                          }
                          label={
                            (filters[config.field] ?? [])[0] === "true"
                              ? "Yes"
                              : "No"
                          }
                        />
                      )}

                      {config.type === "number" && (
                        <TextField
                          size="small"
                          type="number"
                          fullWidth
                          placeholder={config.placeholder ?? "Enter a number"}
                          value={(filters[config.field] ?? [])[0] ?? ""}
                          onChange={(e) =>
                            onFilterValueChange(config.field, e.target.value)
                          }
                          slotProps={{
                            htmlInput: {
                              min: config.min,
                              max: config.max,
                            },
                          }}
                        />
                      )}

                      {config.type === "text" && (
                        <TextField
                          size="small"
                          fullWidth
                          placeholder={config.placeholder ?? "Enter a value"}
                          value={(filters[config.field] ?? [])[0] ?? ""}
                          onChange={(e) =>
                            onFilterValueChange(config.field, e.target.value)
                          }
                        />
                      )}

                      {config.type === "searchable-select" && (() => {
                        const singleProps = {
                          value: (filters[config.field] ?? [])[0] ?? null,
                          onChange: (val: string | null) => onFilterValueChange(config.field, val ?? ""),
                          placeholder: `Select ${config.label.toLowerCase()}...`,
                          size: "small" as const,
                        };
                        if (config.fetchPage) {
                          return <InfiniteScrollSelect fetchPage={config.fetchPage} {...singleProps} />;
                        }
                        if (config.onSearch) {
                          return <AsyncSearchableSelect onSearch={config.onSearch} {...singleProps} />;
                        }
                        return <SearchableSelect options={config.options ?? []} {...singleProps} />;
                      })()}

                      {config.type === "multi-select" && (() => {
                        const multiProps = {
                          value: filters[config.field] ?? [],
                          onChange: (values: string[]) => onFilterChange(config.field, values),
                          placeholder: `Select ${config.label.toLowerCase()}...`,
                          size: "small" as const,
                        };
                        if (config.fetchPage) {
                          return <MultiInfiniteScrollSelect fetchPage={config.fetchPage} {...multiProps} />;
                        }
                        if (config.onSearch) {
                          return <MultiAsyncSearchableSelect onSearch={config.onSearch} {...multiProps} />;
                        }
                        return <MultiSearchableSelect options={config.options ?? []} {...multiProps} />;
                      })()}
                    </Box>
                  ))}
                </Box>
              </Popover>
            </>
          )}

          {/* Sort Button */}
          {sortFields.length > 0 && (
            <>
              <Button
                variant="outlined"
                size="small"
                startIcon={<SortIcon />}
                onClick={(e) => setSortAnchor(e.currentTarget)}
              >
                Sort
              </Button>

              <Popover
                open={sortOpen}
                anchorEl={sortAnchor}
                onClose={() => setSortAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                transformOrigin={{ vertical: "top", horizontal: "left" }}
              >
                <Box sx={{ p: 2, minWidth: 200 }}>
                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    Sort by
                  </Typography>
                  <RadioGroup
                    value={sortBy}
                    onChange={(e) => onSortByChange(e.target.value)}
                  >
                    {sortFields.map((field) => (
                      <FormControlLabel
                        key={field.field}
                        value={field.field}
                        control={<Radio size="small" />}
                        label={field.label}
                      />
                    ))}
                  </RadioGroup>

                  <Divider sx={{ my: 1 }} />

                  <Typography variant="subtitle2" sx={{ mb: 0.5 }}>
                    Direction
                  </Typography>
                  <Box sx={{ display: "flex", gap: 1 }}>
                    <Chip
                      icon={<ArrowUpwardIcon />}
                      label="Asc"
                      size="small"
                      variant={sortOrder === "asc" ? "filled" : "outlined"}
                      color={sortOrder === "asc" ? "primary" : "default"}
                      onClick={() => onSortOrderChange("asc")}
                    />
                    <Chip
                      icon={<ArrowDownwardIcon />}
                      label="Desc"
                      size="small"
                      variant={sortOrder === "desc" ? "filled" : "outlined"}
                      color={sortOrder === "desc" ? "primary" : "default"}
                      onClick={() => onSortOrderChange("desc")}
                    />
                  </Box>
                </Box>
              </Popover>
            </>
          )}

          {/* Advanced Filters Button */}
          {showAdvancedFilters && (
            <>
              <Badge badgeContent={advancedFilterConditionCount} color="secondary">
                <Button
                  variant="outlined"
                  size="small"
                  startIcon={<TuneIcon />}
                  onClick={(e) => setAdvFilterAnchor(e.currentTarget)}
                >
                  Advanced Filters
                </Button>
              </Badge>

              <Popover
                open={advFilterOpen}
                anchorEl={advFilterAnchor}
                onClose={() => setAdvFilterAnchor(null)}
                anchorOrigin={{ vertical: "bottom", horizontal: "left" }}
                transformOrigin={{ vertical: "top", horizontal: "left" }}
                slotProps={{ paper: { sx: { maxHeight: "70vh", overflow: "auto" } } }}
              >
                {advancedFilters && onAdvancedFiltersChange && (
                  <React.Suspense fallback={<Box sx={{ p: 2 }}><Typography variant="body2">Loading...</Typography></Box>}>
                    <AdvancedFilterBuilderLazy
                      expression={advancedFilters}
                      onChange={onAdvancedFiltersChange}
                      columnDefinitions={columnDefinitions!}
                    />
                  </React.Suspense>
                )}
              </Popover>
            </>
          )}

          {/* Spacer */}
          <Box sx={{ flex: 1, display: { xs: "none", sm: "block" } }} />

          {/* Pagination */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5, flexWrap: "wrap", ml: { xs: 0, sm: "auto" } }}>
            <Select
              size="small"
              value={limit}
              onChange={(e) => onLimitChange(Number(e.target.value))}
              sx={{ minWidth: 70, "& .MuiSelect-select": { py: 0.5 } }}
            >
              {limitOptions.map((opt) => (
                <MenuItem key={opt} value={opt}>
                  {opt}
                </MenuItem>
              ))}
            </Select>

            <Typography variant="body2" sx={{ mx: 1, whiteSpace: "nowrap" }}>
              {currentPage} of {totalPages} ({total})
            </Typography>

            <IconButton
              size="small"
              onClick={onFirst}
              disabled={currentPage <= 1}
              aria-label="First page"
            >
              <FirstPageIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onPrev}
              disabled={currentPage <= 1}
              aria-label="Previous page"
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onNext}
              disabled={currentPage >= totalPages}
              aria-label="Next page"
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onLast}
              disabled={currentPage >= totalPages}
              aria-label="Last page"
            >
              <LastPageIcon fontSize="small" />
            </IconButton>
          </Box>
        </Box>

        {/* Active filter chips */}
        {Object.entries(filters).some(([, values]) => values.length > 0) && (
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap" }}>
            {Object.entries(filters).map(([field, values]) => {
              if (values.length === 0) return null;
              const config = filterConfigs.find((c) => c.field === field);
              const label = config?.label ?? field;
              const on = values[0] === "true" ? "Yes" : "No";

              if (config?.type === "boolean") {
                return (
                  <Chip
                    key={field}
                    label={`${label}: ${on}`}
                    size="small"
                    onDelete={() => onFilterValueChange(field, "")}
                  />
                );
              }

              if (config?.type === "multi-select") {
                return values.map((val) => {
                  const optLabel = config.options
                    ? config.options.find((o) => o.value === val)?.label
                    : config.labelMap?.[val];
                  return (
                    <Chip
                      key={`${field}-${val}`}
                      label={`${label}: ${optLabel ?? val}`}
                      size="small"
                      onDelete={() =>
                        onFilterChange(
                          field,
                          values.filter((v) => v !== val)
                        )
                      }
                    />
                  );
                });
              }

              if (config?.type === "searchable-select") {
                const optLabel = config.options
                  ? config.options.find((o) => o.value === values[0])?.label
                  : config.labelMap?.[values[0]];
                return (
                  <Chip
                    key={field}
                    label={`${label}: ${optLabel ?? values[0]}`}
                    size="small"
                    onDelete={() => onFilterValueChange(field, "")}
                  />
                );
              }

              if (config?.type === "number" || config?.type === "text") {
                return (
                  <Chip
                    key={field}
                    label={`${label}: ${values[0]}`}
                    size="small"
                    onDelete={() => onFilterValueChange(field, "")}
                  />
                );
              }

              const option =
                config?.type === "select"
                  ? config.options.find((o) => o.value === values[0])
                  : undefined;
              return (
                <Chip
                  key={field}
                  label={`${label}: ${option?.label ?? values[0]}`}
                  size="small"
                  onDelete={() => onFilterValueChange(field, "")}
                />
              );
            })}
          </Box>
        )}

        {/* Advanced filter chips */}
        {advancedFilters && advancedFilterConditionCount > 0 && onAdvancedFiltersChange && (
          <Box sx={{ display: "flex", gap: 1, flexWrap: "wrap", alignItems: "center" }}>
            {collectConditions(advancedFilters).map((cond, idx) => {
              const colDef = columnDefinitions?.find((c) => c.normalizedKey === cond.field);
              const label = colDef?.normalizedKey ?? cond.field;
              const opLabel = getOperatorLabel(cond.operator);
              const valueStr = cond.value == null
                ? ""
                : Array.isArray(cond.value)
                  ? cond.value.join(", ")
                  : String(cond.value);
              const chipLabel = valueStr
                ? `${label} ${opLabel} ${valueStr}`
                : `${label} ${opLabel}`;

              return (
                <Chip
                  key={`adv-${idx}`}
                  label={chipLabel}
                  size="small"
                  color="secondary"
                  variant="outlined"
                  onDelete={() => {
                    const updated = removeConditionByIndex(advancedFilters, idx);
                    onAdvancedFiltersChange(updated);
                  }}
                />
              );
            })}
            {onAdvancedFiltersClear && (
              <Chip
                label="Clear all"
                size="small"
                variant="outlined"
                onClick={onAdvancedFiltersClear}
                onDelete={onAdvancedFiltersClear}
                deleteIcon={<CloseIcon />}
              />
            )}
          </Box>
        )}
      </Box>
    );
  }
);

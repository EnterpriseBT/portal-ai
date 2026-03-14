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
import { Button, Typography } from "@portalai/core/ui";

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

export type FilterConfig =
  | SelectFilterConfig
  | BooleanFilterConfig
  | NumberFilterConfig
  | TextFilterConfig;

export interface SortFieldConfig {
  field: string;
  label: string;
}

// --- Hook ---

export interface UsePaginationConfig {
  filters?: FilterConfig[];
  sortFields?: SortFieldConfig[];
  defaultSortBy?: string;
  defaultSortOrder?: "asc" | "desc";
  limit?: number;
  limitOptions?: number[];
}

export interface UsePaginationReturn {
  search: string;
  filters: Record<string, string[]>;
  sortBy: string;
  sortOrder: "asc" | "desc";
  offset: number;
  limit: number;
  total: number;
  setSearch: (value: string) => void;
  setFilter: (field: string, values: string[]) => void;
  setFilterValue: (field: string, value: string) => void;
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
  } = config;

  const [search, setSearchRaw] = React.useState("");
  const [filters, setFilters] = React.useState<Record<string, string[]>>(() => {
    const initial: Record<string, string[]> = {};
    for (const fc of filterConfigs) {
      if (fc.defaultValue && fc.defaultValue.length > 0) {
        initial[fc.field] = fc.defaultValue;
      }
    }
    return initial;
  });
  const [sortBy, setSortBy] = React.useState(defaultSortBy);
  const [sortOrder, setSortOrder] = React.useState<"asc" | "desc">(
    defaultSortOrder
  );
  const [offset, setOffset] = React.useState(0);
  const [limit, setLimitRaw] = React.useState(defaultLimit);
  const [total, setTotal] = React.useState(0);

  const resetOffset = React.useCallback(() => setOffset(0), []);

  const setSearch = React.useCallback(
    (value: string) => {
      setSearchRaw(value);
      resetOffset();
    },
    [resetOffset]
  );

  const setFilter = React.useCallback(
    (field: string, values: string[]) => {
      setFilters((prev) => ({ ...prev, [field]: values }));
      resetOffset();
    },
    [resetOffset]
  );

  const toggleSortOrder = React.useCallback(() => {
    setSortOrder((prev) => (prev === "asc" ? "desc" : "asc"));
  }, []);

  const setLimit = React.useCallback(
    (value: number) => {
      setLimitRaw(value);
      resetOffset();
    },
    [resetOffset]
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
      } else {
        params[field] = values[0];
      }
    }
    return params;
  }, [search, filters, filterConfigs, sortBy, sortOrder, offset, limit]);

  const activeFilterCount = Object.values(filters).reduce(
    (count, values) => count + values.length,
    0
  );

  const setFilterValue = React.useCallback(
    (field: string, value: string) => {
      setFilters((prev) => ({
        ...prev,
        [field]: value ? [value] : [],
      }));
      resetOffset();
    },
    [resetOffset]
  );

  const toolbarProps: PaginationToolbarProps = {
    search,
    onSearchChange: setSearch,
    filterConfigs,
    filters,
    onFilterValueChange: setFilterValue,
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
  };

  return {
    search,
    filters,
    sortBy,
    sortOrder,
    offset,
    limit,
    total,
    setSearch,
    setFilter,
    setFilterValue,
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
    },
    ref
  ) => {
    const [filterAnchor, setFilterAnchor] = React.useState<HTMLElement | null>(
      null
    );
    const [sortAnchor, setSortAnchor] = React.useState<HTMLElement | null>(
      null
    );

    const filterOpen = Boolean(filterAnchor);
    const sortOpen = Boolean(sortAnchor);

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
                    >
                      <CloseIcon fontSize="small" />
                    </IconButton>
                  </InputAdornment>
                ) : undefined,
              },
            }}
            sx={{ minWidth: 200 }}
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

          {/* Spacer */}
          <Box sx={{ flex: 1 }} />

          {/* Pagination */}
          <Box sx={{ display: "flex", alignItems: "center", gap: 0.5 }}>
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
            >
              <FirstPageIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onPrev}
              disabled={currentPage <= 1}
            >
              <ChevronLeftIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onNext}
              disabled={currentPage >= totalPages}
            >
              <ChevronRightIcon fontSize="small" />
            </IconButton>
            <IconButton
              size="small"
              onClick={onLast}
              disabled={currentPage >= totalPages}
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
      </Box>
    );
  }
);

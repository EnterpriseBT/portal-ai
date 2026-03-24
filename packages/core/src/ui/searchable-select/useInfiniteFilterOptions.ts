import React from "react";

import type { SelectOption, FetchPageParams, FetchPageResult } from "./types.js";

/** Configuration for useInfiniteFilterOptions. Define at module scope for a stable reference. */
export interface InfiniteFilterOptionsConfig<TResponse, TItem> {
  /** API endpoint path, e.g. "/api/entity-tags" */
  url: string;
  /** Fetch function that receives a URL and returns parsed JSON. */
  fetcher: (url: string) => Promise<TResponse>;
  /** Extract the item array from the API response payload. */
  getItems: (response: TResponse) => TItem[];
  /** Extract the total count from the API response payload. */
  getTotal: (response: TResponse) => number;
  /** Map a single item to a select option. */
  mapItem: (item: TItem) => { value: string; label: string };
  /** Default sort field (defaults to "name"). */
  sortBy?: string;
  /** Default sort order (defaults to "asc"). */
  sortOrder?: "asc" | "desc";
}

export interface InfiniteFilterOptionsResult {
  fetchPage: (params: FetchPageParams) => Promise<FetchPageResult>;
  labelMap: Record<string, string>;
}

function buildQueryString(params: Record<string, string | number>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null) continue;
    parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

export function useInfiniteFilterOptions<TResponse, TItem>(
  config: InfiniteFilterOptionsConfig<TResponse, TItem>
): InfiniteFilterOptionsResult {
  const [labelMap, setLabelMap] = React.useState<Record<string, string>>({});
  const configRef = React.useRef(config);
  React.useEffect(() => {
    configRef.current = config;
  });

  const fetchPage = React.useCallback(
    async (params: FetchPageParams): Promise<FetchPageResult> => {
      const cfg = configRef.current;
      const query: Record<string, string | number> = {
        limit: params.pageSize,
        offset: params.page * params.pageSize,
        sortBy: cfg.sortBy ?? "name",
        sortOrder: cfg.sortOrder ?? "asc",
      };
      if (params.search) query.search = params.search;

      const url = `${cfg.url}${buildQueryString(query)}`;
      const data = await cfg.fetcher(url);
      const items = cfg.getItems(data);
      const total = cfg.getTotal(data);
      const options: SelectOption[] = items.map(cfg.mapItem);

      setLabelMap((prev) => {
        const next = { ...prev };
        for (const opt of options) {
          next[String(opt.value)] = opt.label;
        }
        return next;
      });

      const hasMore = params.page * params.pageSize + options.length < total;
      return { options, hasMore };
    },
    [] // stable — reads latest config via ref
  );

  return { fetchPage, labelMap };
}

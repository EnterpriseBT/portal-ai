import React from "react";

import type { SelectOption } from "./types.js";

/** Configuration for useAsyncFilterOptions. Define at module scope for a stable reference. */
export interface AsyncFilterOptionsConfig<TResponse, TItem> {
  /** API endpoint path, e.g. "/api/entity-tags" */
  url: string;
  /** Fetch function that receives a URL and returns parsed JSON. */
  fetcher: (url: string) => Promise<TResponse>;
  /** Extract the item array from the API response payload. */
  getItems: (response: TResponse) => TItem[];
  /** Map a single item to a select option. */
  mapItem: (item: TItem) => { value: string; label: string };
}

export interface AsyncFilterOptionsResult {
  onSearch: (query: string) => Promise<SelectOption[]>;
  labelMap: Record<string, string>;
}

function appendQuery(url: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return qs ? `${url}?${qs}` : url;
}

export function useAsyncFilterOptions<TResponse, TItem>(
  config: AsyncFilterOptionsConfig<TResponse, TItem>
): AsyncFilterOptionsResult {
  const [labelMap, setLabelMap] = React.useState<Record<string, string>>({});

  const onSearch = React.useCallback(
    async (query: string): Promise<SelectOption[]> => {
      const params: Record<string, string> = {};
      if (query) params.search = query;

      const data = await config.fetcher(appendQuery(config.url, params));
      const options: SelectOption[] = config.getItems(data).map(config.mapItem);

      setLabelMap((prev) => {
        const next = { ...prev };
        for (const opt of options) {
          next[String(opt.value)] = opt.label;
        }
        return next;
      });

      return options;
    },
    [config]
  );

  return { onSearch, labelMap };
}

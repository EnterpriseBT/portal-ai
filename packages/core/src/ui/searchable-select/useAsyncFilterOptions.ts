import React from "react";

import type { SelectOption } from "./types.js";

/** Configuration for useAsyncFilterOptions. Define at module scope for a stable reference. */
export interface AsyncFilterOptionsConfig<
  TResponse,
  TItem,
  TOption extends SelectOption = SelectOption,
> {
  /** API endpoint path, e.g. "/api/entity-tags" */
  url: string;
  /** Fetch function that receives a URL and returns parsed JSON. */
  fetcher: (url: string) => Promise<TResponse>;
  /** Extract the item array from the API response payload. */
  getItems: (response: TResponse) => TItem[];
  /** Map a single item to a select option (may include extra data beyond value/label). */
  mapItem: (item: TItem) => TOption;
  /** Extra query parameters appended to every search request (e.g. `{ capability: "write" }`). */
  defaultParams?: Record<string, string>;
  /**
   * Load a single option by ID (e.g. fetch by ID from API).
   * When provided, the hook exposes `loadSelectedOption` on the result.
   * The SDK layer constructs this — core has no knowledge of get-endpoint URLs.
   */
  loadSelectedOption?: (id: string) => Promise<TOption | null>;
}

export interface AsyncFilterOptionsResult<
  TOption extends SelectOption = SelectOption,
> {
  onSearch: (query: string) => Promise<TOption[]>;
  /** Resolve a single option by ID. Undefined when not configured. */
  loadSelectedOption: ((id: string) => Promise<TOption | null>) | undefined;
  labelMap: Record<string, string>;
}

function appendQuery(url: string, params: Record<string, string>): string {
  const qs = Object.entries(params)
    .filter(([, v]) => v !== undefined && v !== "")
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join("&");
  return qs ? `${url}?${qs}` : url;
}

export function useAsyncFilterOptions<
  TResponse,
  TItem,
  TOption extends SelectOption = SelectOption,
>(
  config: AsyncFilterOptionsConfig<TResponse, TItem, TOption>
): AsyncFilterOptionsResult<TOption> {
  const [labelMap, setLabelMap] = React.useState<Record<string, string>>({});

  const onSearch = React.useCallback(
    async (query: string): Promise<TOption[]> => {
      const params: Record<string, string> = { ...config.defaultParams };
      if (query) params.search = query;

      const data = await config.fetcher(appendQuery(config.url, params));
      const options: TOption[] = config.getItems(data).map(config.mapItem);

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

  const loadSelectedOption = React.useMemo(() => {
    if (!config.loadSelectedOption) return undefined;
    const loader = config.loadSelectedOption;
    return async (id: string): Promise<TOption | null> => {
      const option = await loader(id);
      if (option) {
        setLabelMap((prev) => ({
          ...prev,
          [String(option.value)]: option.label,
        }));
      }
      return option;
    };
  }, [config.loadSelectedOption]);

  return { onSearch, loadSelectedOption, labelMap };
}

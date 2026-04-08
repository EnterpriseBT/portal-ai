import type { QueryKey, UseQueryOptions } from "@tanstack/react-query";
import type { SelectOption } from "@portalai/core/ui";
import type { ApiError } from "../utils/api.util";

export type QueryOptions<T> = Omit<
  UseQueryOptions<T, ApiError, T, QueryKey>,
  "queryKey" | "queryFn"
>;

/** Options for SDK `search()` hooks. Override `mapItem` for rich options or custom labels. */
export interface SearchHookOptions<TItem, TOption extends SelectOption = SelectOption> {
  mapItem?: (item: TItem) => TOption;
  defaultParams?: Record<string, string>;
}

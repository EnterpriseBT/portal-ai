import type { QueryKey, UseQueryOptions } from "@tanstack/react-query";

export type QueryOptions<T> = Omit<
  UseQueryOptions<T, Error, T, QueryKey>,
  "queryKey" | "queryFn"
>;

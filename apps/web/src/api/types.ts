import type { QueryKey, UseQueryOptions } from "@tanstack/react-query";
import type { ApiError } from "../utils/api.util";

export type QueryOptions<T> = Omit<
  UseQueryOptions<T, ApiError, T, QueryKey>,
  "queryKey" | "queryFn"
>;

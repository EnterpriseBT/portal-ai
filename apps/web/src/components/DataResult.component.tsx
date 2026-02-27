import React from "react";
import { StatusMessage } from "@mcp-ui/core/ui";

export interface QueryResultLike<TData = unknown> {
  data: TData | undefined;
  error: Error | null;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
}

export interface ResultOptions {
  errorMessage?: string;
  loadingMessage?: string;
  renderError?: (error: Error) => React.ReactNode;
  renderLoading?: () => React.ReactNode;
}

export type ResultsMap = Record<string, QueryResultLike>;

type ExtractDataMap<T extends ResultsMap> = {
  [K in keyof T]: T[K] extends QueryResultLike<infer D> ? D : never;
};

export interface DataResultProps<T extends ResultsMap> {
  results: T;
  options?: { [K in keyof T]?: ResultOptions };
  children: (data: ExtractDataMap<T>) => React.ReactNode;
  loadingMessage?: string;
  className?: string;
  [key: `data-${string}`]: string;
}

export function DataResult<T extends ResultsMap>({
  results,
  options,
  children,
  loadingMessage = "Loading...",
  className,
  ...rest
}: DataResultProps<T>): React.ReactElement | null {
  const entries = Object.entries(results) as [string, QueryResultLike][];

  // Error: find first errored entry
  const errorEntry = entries.find(([, query]) => query.isError && query.error);
  if (errorEntry) {
    const [key, query] = errorEntry;
    const error = query.error!;
    const opts = options?.[key];

    if (opts?.renderError) {
      return <>{opts.renderError(error)}</>;
    }

    if (opts?.errorMessage) {
      return (
        <StatusMessage
          variant="error"
          message={opts.errorMessage}
          className={className}
          {...rest}
        />
      );
    }

    return (
      <StatusMessage
        variant="error"
        error={error}
        className={className}
        {...rest}
      />
    );
  }

  // Loading: find first loading entry
  const loadingEntry = entries.find(([, query]) => query.isLoading);
  if (loadingEntry) {
    const [key] = loadingEntry;
    const opts = options?.[key];

    if (opts?.renderLoading) {
      return <>{opts.renderLoading()}</>;
    }

    return (
      <StatusMessage
        loading
        message={opts?.loadingMessage ?? loadingMessage}
        className={className}
        {...rest}
      />
    );
  }

  // Success: build data map and call children
  const dataMap = Object.fromEntries(
    entries.map(([k, query]) => [k, query.data])
  ) as ExtractDataMap<T>;

  return <>{children(dataMap)}</>;
}

export default DataResult;

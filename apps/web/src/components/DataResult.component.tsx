import React from "react";
import { HiddenPageHeading, StatusMessage } from "@portalai/core/ui";

export interface QueryResultLike<TData = unknown> {
  data: TData | undefined;
  error: Error | null;
  isLoading: boolean;
  isError: boolean;
  isSuccess: boolean;
  limit?: boolean;
  total?: number;
  offset?: number;
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
  /** The page's name (e.g. "Job"). A detail view whose PageHeader renders
   *  only once its data loads passes it, so the loading and error states
   *  keep an h1 for screen readers and the tab title (#797). */
  pageTitle?: string;
  className?: string;
  [key: `data-${string}`]: string;
}

export function DataResult<T extends ResultsMap>({
  results,
  options,
  children,
  loadingMessage = "Loading...",
  pageTitle,
  className,
  ...rest
}: DataResultProps<T>): React.ReactElement | null {
  const entries = Object.entries(results) as [string, QueryResultLike][];
  const withTitle = (status: React.ReactNode) => (
    <>
      {pageTitle && <HiddenPageHeading>{pageTitle}</HiddenPageHeading>}
      {status}
    </>
  );

  // Error: find first errored entry
  const errorEntry = entries.find(([, query]) => query.isError && query.error);
  if (errorEntry) {
    const [key, query] = errorEntry;
    const error = query.error!;
    const opts = options?.[key];

    if (opts?.renderError) {
      return withTitle(opts.renderError(error));
    }

    if (opts?.errorMessage) {
      return withTitle(
        <StatusMessage
          variant="error"
          message={opts.errorMessage}
          className={className}
          {...rest}
        />
      );
    }

    return withTitle(
      <StatusMessage
        variant="error"
        error={error}
        className={className}
        {...rest}
      />
    );
  }

  // Loading: find first entry with no data yet. React Query v5's isLoading
  // is isPending && isFetching, so a query paused offline has no data but
  // isn't "loading"; it waits here (keeping the page's h1, #982) rather than
  // handing children undefined data.
  const loadingEntry = entries.find(
    ([, query]) =>
      query.isLoading || (!query.isSuccess && query.data === undefined)
  );
  if (loadingEntry) {
    const [key] = loadingEntry;
    const opts = options?.[key];

    if (opts?.renderLoading) {
      return withTitle(opts.renderLoading());
    }

    return withTitle(
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

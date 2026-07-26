import { useAuthMutation, useAuthQuery } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";
import type { WidgetRefreshResponse } from "@portalai/core/contracts";

/**
 * Frontend SDK for the portal-sql query-handle endpoints (#85 Phase 3).
 *
 * Snapshot fetch returns a paged window of rows the server staged in
 * Redis. The handle was produced by `sql_query` / `visualize` /
 * `visualize_tree` for result sets exceeding `INLINE_ROWS_THRESHOLD`.
 */

export interface HandleSnapshotPayload {
  rows: Array<Record<string, unknown>>;
  total: number;
  offset: number;
  limit: number;
}

export const portalSql = {
  /**
   * Paged snapshot of a query handle's staged rows. Surfaces
   * READ_HANDLE_EXPIRED via the standard SDK error path when the
   * handle's cache has aged out (24h TTL).
   */
  handleSnapshot: (
    handleId: string,
    params: { offset?: number; limit?: number } = {},
    options?: QueryOptions<HandleSnapshotPayload>
  ) =>
    useAuthQuery<HandleSnapshotPayload>(
      queryKeys.portalSql.handleSnapshot(handleId, params),
      `/api/portal-sql/handle/${encodeURIComponent(handleId)}?offset=${
        params.offset ?? 0
      }&limit=${params.limit ?? 5_000}`,
      undefined,
      options
    ),

  /**
   * Imperative paged snapshot read (#268) — drives the D3 widget's
   * progressive fetch loop (`useProgressiveHandleRows`), which issues
   * one call per page as the loop advances. A per-invocation GET, so
   * it rides `useAuthMutation` rather than a keyed declarative query.
   */
  handleSnapshotPage: () =>
    useAuthMutation<
      HandleSnapshotPayload,
      { handleId: string; offset: number; limit: number }
    >({
      url: (vars) =>
        `/api/portal-sql/handle/${encodeURIComponent(vars.handleId)}?offset=${
          vars.offset
        }&limit=${vars.limit}`,
      method: "GET",
      body: () => undefined,
    }),

  /**
   * Re-execute a persisted `d3` widget's durable pipeline for fresh data
   * (#270). Reference-based — the server holds the SQL; the client sends only
   * `{ messageId, blockIndex }`. Returns a fresh delivery (inline rows or a new
   * handle envelope) the widget swaps into its render branch. Imperative, so it
   * rides `useAuthMutation` (fired on mount/visibility or the manual button).
   */
  widgetRefresh: () =>
    useAuthMutation<
      WidgetRefreshResponse,
      { messageId: string; blockIndex: number }
    >({
      url: () => `/api/portal-sql/widget-refresh`,
      method: "POST",
      body: (vars) => vars,
    }),
};

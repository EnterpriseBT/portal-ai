import { useAuthQuery } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

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
};

import type {
  CuratedViewListRequestQuery,
  CuratedViewListResponsePayload,
  CuratedViewGetResponsePayload,
  CuratedViewCreateRequestBody,
  CuratedViewCreateResponsePayload,
  CuratedViewUpdateRequestBody,
  CuratedViewUpdateResponsePayload,
  CuratedViewAttachRequestBody,
  CuratedViewAttachResponsePayload,
  CuratedViewRecordsRequestQuery,
  CuratedViewRecordsResponsePayload,
  CuratedViewFilterSqlPreviewRequestBody,
  CuratedViewFilterSqlPreviewResponsePayload,
  CuratedViewFilterSqlSuggestRequestBody,
  CuratedViewFilterSqlSuggestResponsePayload,
} from "@portalai/core/contracts";
import {
  LONG_WRITE_TIMEOUT_MS,
  useAuthMutation,
  useAuthQuery,
} from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const CURATED_VIEWS_URL = "/api/curated-views";

export const curatedViews = {
  list: (
    params?: CuratedViewListRequestQuery,
    options?: QueryOptions<CuratedViewListResponsePayload>
  ) =>
    useAuthQuery<CuratedViewListResponsePayload>(
      queryKeys.curatedViews.list(params),
      buildUrl(CURATED_VIEWS_URL, params),
      undefined,
      options
    ),

  /**
   * #674: an imperative, per-keystroke search for the station view picker.
   * The list endpoint is visibility-filtered server-side, so it only ever
   * offers views the caller can read.
   */
  search: () =>
    useAuthMutation<
      CuratedViewListResponsePayload,
      { search: string; limit: number }
    >({
      url: (vars) =>
        buildUrl(CURATED_VIEWS_URL, {
          search: vars.search,
          limit: vars.limit,
          offset: 0,
          sortBy: "label",
          sortOrder: "asc",
        }),
      method: "GET",
      body: () => undefined,
    }),

  get: (id: string, options?: QueryOptions<CuratedViewGetResponsePayload>) =>
    useAuthQuery<CuratedViewGetResponsePayload>(
      queryKeys.curatedViews.get(id),
      buildUrl(`${CURATED_VIEWS_URL}/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  records: (
    id: string,
    params?: CuratedViewRecordsRequestQuery,
    options?: QueryOptions<CuratedViewRecordsResponsePayload>
  ) =>
    useAuthQuery<CuratedViewRecordsResponsePayload>(
      queryKeys.curatedViews.records(id, params),
      buildUrl(
        `${CURATED_VIEWS_URL}/${encodeURIComponent(id)}/records`,
        params
      ),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<
      CuratedViewCreateResponsePayload,
      CuratedViewCreateRequestBody
    >({
      url: CURATED_VIEWS_URL,
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<
      CuratedViewUpdateResponsePayload,
      CuratedViewUpdateRequestBody
    >({
      url: `${CURATED_VIEWS_URL}/${encodeURIComponent(id)}`,
      method: "PATCH",
      // #688: a 403 means the caller's capabilities changed; refetch so the
      // affordances re-render from them.
      onPermissionDenied: { invalidate: () => [queryKeys.curatedViews.root] },
    }),

  /**
   * #644: the first rows a draft SQL filter selects (no total). Imperative:
   * the editor runs it on demand. Long timeout: it's a query, bounded by the
   * server's statement timeout.
   */
  previewFilterSql: () =>
    useAuthMutation<
      CuratedViewFilterSqlPreviewResponsePayload,
      CuratedViewFilterSqlPreviewRequestBody
    >({
      url: `${CURATED_VIEWS_URL}/filter-sql/preview`,
      method: "POST",
      timeoutMs: LONG_WRITE_TIMEOUT_MS,
      // A 403/404 means the caller's access to the view or its entity
      // changed; refetch so the editor's affordances follow it.
      onPermissionDenied: { invalidate: () => [queryKeys.curatedViews.root] },
    }),

  /** #644: a model-suggested SQL filter that already passed validation. */
  suggestFilterSql: () =>
    useAuthMutation<
      CuratedViewFilterSqlSuggestResponsePayload,
      CuratedViewFilterSqlSuggestRequestBody
    >({
      url: `${CURATED_VIEWS_URL}/filter-sql/suggest`,
      method: "POST",
      timeoutMs: LONG_WRITE_TIMEOUT_MS,
      // A 403/404 means the caller's access to the view or its entity
      // changed; refetch so the editor's affordances follow it.
      onPermissionDenied: { invalidate: () => [queryKeys.curatedViews.root] },
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${CURATED_VIEWS_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
      onPermissionDenied: { invalidate: () => [queryKeys.curatedViews.root] },
    }),

  attach: (id: string) =>
    useAuthMutation<
      CuratedViewAttachResponsePayload,
      CuratedViewAttachRequestBody
    >({
      url: `${CURATED_VIEWS_URL}/${encodeURIComponent(id)}/attach`,
      method: "POST",
      onPermissionDenied: {
        invalidate: () => [
          queryKeys.curatedViews.root,
          queryKeys.stations.root,
        ],
      },
    }),

  detach: (id: string, stationId: string) =>
    useAuthMutation<void, void>({
      url: `${CURATED_VIEWS_URL}/${encodeURIComponent(id)}/attach/${encodeURIComponent(stationId)}`,
      method: "DELETE",
      onPermissionDenied: {
        invalidate: () => [
          queryKeys.curatedViews.root,
          queryKeys.stations.root,
        ],
      },
    }),
};

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
} from "@portalai/core/contracts";
import { useAuthMutation, useAuthQuery } from "../utils/api.util";
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
    }),

  delete: (id: string) =>
    useAuthMutation<void, void>({
      url: `${CURATED_VIEWS_URL}/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  attach: (id: string) =>
    useAuthMutation<
      CuratedViewAttachResponsePayload,
      CuratedViewAttachRequestBody
    >({
      url: `${CURATED_VIEWS_URL}/${encodeURIComponent(id)}/attach`,
      method: "POST",
    }),

  detach: (id: string, stationId: string) =>
    useAuthMutation<void, void>({
      url: `${CURATED_VIEWS_URL}/${encodeURIComponent(id)}/attach/${encodeURIComponent(stationId)}`,
      method: "DELETE",
    }),
};

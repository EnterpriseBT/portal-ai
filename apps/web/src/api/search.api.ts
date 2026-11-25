import { keepPreviousData } from "@tanstack/react-query";
import type {
  SearchRequestQuery,
  SearchResponsePayload,
} from "@portalai/core/contracts";

import { useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

const SEARCH_URL = "/api/search";

export const search = {
  /**
   * #1076: the command palette's read-scoped search. A superseded query is
   * aborted (`meta.abortable`), the previous results stay up while the next
   * loads, and `staleTime: 0` refetches each time the palette opens, so a
   * create, rename, delete or star shows without per-mutation invalidation.
   */
  query: (
    params: SearchRequestQuery,
    options?: QueryOptions<SearchResponsePayload>
  ) =>
    useAuthQuery<SearchResponsePayload>(
      queryKeys.search.query(params),
      buildUrl(SEARCH_URL, params),
      undefined,
      {
        meta: { abortable: true },
        placeholderData: keepPreviousData,
        staleTime: 0,
        ...options,
      }
    ),
};

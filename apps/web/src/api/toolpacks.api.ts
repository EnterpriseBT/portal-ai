import type {
  ToolpackListRequestQuery,
  ToolpackListResponsePayload,
  ToolpackGetResponsePayload,
} from "@portalai/core/contracts";

import { useAuthQuery } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const toolpacks = {
  list: (
    params?: ToolpackListRequestQuery,
    options?: QueryOptions<ToolpackListResponsePayload>
  ) =>
    useAuthQuery<ToolpackListResponsePayload>(
      queryKeys.toolpacks.list(params),
      buildUrl("/api/toolpacks", params),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<ToolpackGetResponsePayload>
  ) =>
    useAuthQuery<ToolpackGetResponsePayload>(
      queryKeys.toolpacks.get(id),
      buildUrl(`/api/toolpacks/${encodeURIComponent(id)}`),
      undefined,
      options
    ),
};

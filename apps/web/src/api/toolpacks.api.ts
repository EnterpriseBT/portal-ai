import type {
  ToolpackListRequestQuery,
  ToolpackListResponsePayload,
  ToolpackGetResponsePayload,
  RegisterToolpackBody,
  UpdateToolpackBody,
  ToolpackRegisterResponsePayload,
  ToolpackUpdateResponsePayload,
  ToolpackRefreshResponsePayload,
  ToolpackDeleteResponsePayload,
} from "@portalai/core/contracts";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
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

  get: (id: string, options?: QueryOptions<ToolpackGetResponsePayload>) =>
    useAuthQuery<ToolpackGetResponsePayload>(
      queryKeys.toolpacks.get(id),
      buildUrl(`/api/toolpacks/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  register: () =>
    useAuthMutation<ToolpackRegisterResponsePayload, RegisterToolpackBody>({
      url: "/api/toolpacks",
    }),

  update: (id: string) =>
    useAuthMutation<ToolpackUpdateResponsePayload, UpdateToolpackBody>({
      url: `/api/toolpacks/${encodeURIComponent(id)}`,
      method: "PATCH",
    }),

  remove: (id: string) =>
    useAuthMutation<ToolpackDeleteResponsePayload, void>({
      url: `/api/toolpacks/${encodeURIComponent(id)}`,
      method: "DELETE",
    }),

  refresh: (id: string) =>
    useAuthMutation<ToolpackRefreshResponsePayload, void>({
      url: `/api/toolpacks/${encodeURIComponent(id)}/refresh`,
    }),
};

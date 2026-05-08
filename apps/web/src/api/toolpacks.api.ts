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
  ToolpackRotateSigningSecretResponsePayload,
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

  /**
   * Manual schema/metadata refresh. The ID is passed as a mutation
   * variable rather than baked into the URL at hook-creation time so
   * a single shared mutation can serve both the edit-dialog refresh
   * button and the row-level refresh icon (which has a different ID
   * per row). Calling the SDK getter from an event handler would
   * violate the Rules of Hooks.
   */
  refresh: () =>
    useAuthMutation<ToolpackRefreshResponsePayload, { id: string }>({
      method: "POST",
      url: ({ id }) => `/api/toolpacks/${encodeURIComponent(id)}/refresh`,
      body: () => undefined,
    }),

  rotateSigningSecret: (id: string) =>
    useAuthMutation<ToolpackRotateSigningSecretResponsePayload, void>({
      url: `/api/toolpacks/${encodeURIComponent(id)}/rotate-signing-secret`,
    }),
};

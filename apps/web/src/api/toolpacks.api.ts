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

import {
  useAuthQuery,
  useAuthMutation,
  LONG_WRITE_TIMEOUT_MS,
} from "../utils/api.util";
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

  // Register, and an update that changes endpoints, fetch the webhook's
  // schema and metadata before answering, the same work as refresh.
  register: () =>
    useAuthMutation<ToolpackRegisterResponsePayload, RegisterToolpackBody>({
      url: "/api/toolpacks",
      timeoutMs: LONG_WRITE_TIMEOUT_MS,
    }),

  update: (id: string) =>
    useAuthMutation<ToolpackUpdateResponsePayload, UpdateToolpackBody>({
      url: `/api/toolpacks/${encodeURIComponent(id)}`,
      method: "PATCH",
      timeoutMs: LONG_WRITE_TIMEOUT_MS,
      onPermissionDenied: { invalidate: () => [queryKeys.toolpacks.root] },
    }),

  remove: (id: string) =>
    useAuthMutation<ToolpackDeleteResponsePayload, void>({
      url: `/api/toolpacks/${encodeURIComponent(id)}`,
      method: "DELETE",
      onPermissionDenied: { invalidate: () => [queryKeys.toolpacks.root] },
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
      timeoutMs: LONG_WRITE_TIMEOUT_MS,
      body: () => undefined,
      onPermissionDenied: { invalidate: () => [queryKeys.toolpacks.root] },
    }),

  rotateSigningSecret: (id: string) =>
    useAuthMutation<ToolpackRotateSigningSecretResponsePayload, void>({
      url: `/api/toolpacks/${encodeURIComponent(id)}/rotate-signing-secret`,
      onPermissionDenied: { invalidate: () => [queryKeys.toolpacks.root] },
    }),
};

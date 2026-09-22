import type {
  PolicyUpsertRequest,
  PolicyResponse,
  PolicyListResponse,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

/**
 * RBAC custom policy authoring (#622) — `sdk.policies`. Owner/admin +
 * `customRbac`-entitled only (server-enforced); mutations don't self-invalidate,
 * the caller invalidates `queryKeys.policies.root` on success.
 */
export const policies = {
  list: (options?: QueryOptions<PolicyListResponse>) =>
    useAuthQuery<PolicyListResponse>(
      queryKeys.policies.root,
      "/api/policies",
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<PolicyResponse, PolicyUpsertRequest>({
      url: "/api/policies",
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<PolicyResponse, PolicyUpsertRequest>({
      url: `/api/policies/${encodeURIComponent(id)}`,
      method: "PUT",
    }),

  remove: () =>
    useAuthMutation<{ id: string }, { id: string }>({
      url: (v) => `/api/policies/${encodeURIComponent(v.id)}`,
      method: "DELETE",
      body: () => undefined,
    }),
};

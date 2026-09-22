import type {
  RoleUpsertRequest,
  RoleResponse,
  RoleListResponse,
} from "@portalai/core/contracts";
import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

/**
 * RBAC custom role authoring (#622) — `sdk.roles`. A role bundles policies; the
 * server boundary-checks the union. Owner/admin + `customRbac`-entitled only.
 */
export const roles = {
  list: (options?: QueryOptions<RoleListResponse>) =>
    useAuthQuery<RoleListResponse>(
      queryKeys.roles.root,
      "/api/roles",
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<RoleResponse, RoleUpsertRequest>({
      url: "/api/roles",
      method: "POST",
    }),

  update: (id: string) =>
    useAuthMutation<RoleResponse, RoleUpsertRequest>({
      url: `/api/roles/${encodeURIComponent(id)}`,
      method: "PUT",
    }),

  remove: () =>
    useAuthMutation<{ id: string }, { id: string }>({
      url: (v) => `/api/roles/${encodeURIComponent(v.id)}`,
      method: "DELETE",
      body: () => undefined,
    }),
};

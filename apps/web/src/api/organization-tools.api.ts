import type {
  OrganizationToolListRequestQuery,
  OrganizationToolListResponsePayload,
  OrganizationToolGetResponsePayload,
  OrganizationToolCreateResponsePayload,
  OrganizationToolUpdateResponsePayload,
  CreateOrganizationToolBody,
  UpdateOrganizationToolBody,
} from "@portalai/core/contracts";

import { useAuthQuery, useAuthMutation } from "../utils/api.util";
import { buildUrl } from "../utils/url.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const organizationTools = {
  list: (
    params?: OrganizationToolListRequestQuery,
    options?: QueryOptions<OrganizationToolListResponsePayload>
  ) =>
    useAuthQuery<OrganizationToolListResponsePayload>(
      queryKeys.organizationTools.list(params),
      buildUrl("/api/organization-tools", params),
      undefined,
      options
    ),

  get: (
    id: string,
    options?: QueryOptions<OrganizationToolGetResponsePayload>
  ) =>
    useAuthQuery<OrganizationToolGetResponsePayload>(
      queryKeys.organizationTools.get(id),
      buildUrl(`/api/organization-tools/${encodeURIComponent(id)}`),
      undefined,
      options
    ),

  create: () =>
    useAuthMutation<
      OrganizationToolCreateResponsePayload,
      CreateOrganizationToolBody
    >({
      url: "/api/organization-tools",
    }),

  update: (toolId: string) =>
    useAuthMutation<
      OrganizationToolUpdateResponsePayload,
      UpdateOrganizationToolBody
    >({
      url: `/api/organization-tools/${encodeURIComponent(toolId)}`,
      method: "PATCH",
    }),

  remove: (toolId: string) =>
    useAuthMutation<{ id: string }, void>({
      url: `/api/organization-tools/${encodeURIComponent(toolId)}`,
      method: "DELETE",
    }),
};

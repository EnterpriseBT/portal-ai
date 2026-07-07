import type {
  OrganizationGetResponse,
  OrganizationUsageGetResponse,
} from "@portalai/core/contracts";
import { useAuthQuery } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const organizations = {
  current: (options?: QueryOptions<OrganizationGetResponse>) =>
    useAuthQuery<OrganizationGetResponse>(
      queryKeys.organizations.current(),
      "/api/organization/current",
      undefined,
      options
    ),
  usage: (options?: QueryOptions<OrganizationUsageGetResponse>) =>
    useAuthQuery<OrganizationUsageGetResponse>(
      queryKeys.organizations.usage(),
      "/api/organization/usage",
      undefined,
      options
    ),
};

import type { OrganizationGetResponse } from "@mcp-ui/core/contracts";
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
};

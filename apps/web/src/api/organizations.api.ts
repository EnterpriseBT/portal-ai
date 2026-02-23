import type {
  ApiSuccessResponse,
  OrganizationGetResponse,
} from "@mcp-ui/core/contracts";
import { useAuthQuery } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const organizations = {
  current: (
    options?: QueryOptions<ApiSuccessResponse<OrganizationGetResponse>>
  ) =>
    useAuthQuery<ApiSuccessResponse<OrganizationGetResponse>>(
      queryKeys.organizations.current(),
      "/api/organization/current",
      undefined,
      options
    ),
};

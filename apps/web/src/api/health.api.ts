import type {
  ApiSuccessResponse,
  HealthGetResponse,
} from "@mcp-ui/core/contracts";
import { useAuthQuery } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const health = {
  check: (options?: QueryOptions<ApiSuccessResponse<HealthGetResponse>>) =>
    useAuthQuery<ApiSuccessResponse<HealthGetResponse>>(
      queryKeys.health.check(),
      "/api/health",
      undefined,
      options
    ),
};

import type { HealthGetResponse } from "@portalai/core/contracts";
import { useAuthQuery } from "../utils/api.util";
import { queryKeys } from "./keys";
import type { QueryOptions } from "./types";

export const health = {
  check: (options?: QueryOptions<HealthGetResponse>) =>
    useAuthQuery<HealthGetResponse>(
      queryKeys.health.check(),
      "/api/health",
      undefined,
      options
    ),
};

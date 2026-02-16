import { type ApiSuccessResponse, type HealthGetResponse } from "@mcp-ui/core";
import { useAuthQuery } from "../utils/api.util";

/**
 * Hook to check the API health status.
 * Uses `useAuthQuery` to make an authenticated GET request to `/api/health`.
 *
 * Usage:
 *   const { data, isLoading, error } = useHealth();
 */
export const useHealth = () => {
  return useAuthQuery<ApiSuccessResponse<HealthGetResponse>>(
    ["health"],
    "/api/health"
  );
};

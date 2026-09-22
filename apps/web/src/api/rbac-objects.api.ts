import { useCallback } from "react";

import type { SelectOption } from "@portalai/core/ui";
import type {
  ApiSuccessResponse,
  RbacObjectSearchResponse,
} from "@portalai/core/contracts";

import { useAuthFetch } from "../utils/api.util";

/**
 * The instance-picker search (#622) — a hand-rolled `useAuthFetch` hook (the
 * sanctioned exception for search selects that feed a label map, per
 * `utils/api.util.ts`). Returns a `(resourceType, query) => SelectOption[]`
 * the policy statement editor hands to `MultiAsyncSearchableSelect.onSearch`,
 * so an author picks objects by name, never a typed id.
 */
export function useRbacObjectSearch() {
  const { fetchWithAuth } = useAuthFetch();
  return useCallback(
    async (resourceType: string, query: string): Promise<SelectOption[]> => {
      if (!resourceType) return [];
      const res = await fetchWithAuth<
        ApiSuccessResponse<RbacObjectSearchResponse>
      >(
        `/api/rbac/objects?resourceType=${encodeURIComponent(
          resourceType
        )}&search=${encodeURIComponent(query)}`
      );
      return (res.payload.objects ?? []).map((o) => ({
        value: o.id,
        label: o.label,
      }));
    },
    [fetchWithAuth]
  );
}

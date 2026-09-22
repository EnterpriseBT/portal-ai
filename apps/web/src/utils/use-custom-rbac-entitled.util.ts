import { sdk } from "../api/sdk";

/**
 * Whether the organization's plan includes custom RBAC authoring (#622).
 *
 * Sourced from the tier policy `GET /api/organization/usage` already ships
 * (the same cache entry Settings/Toolpacks hold — zero extra fetches). Unlike
 * #214's toolpack read, this **fails closed** (`?? false`): it gates authoring,
 * so when the entitlement is unknown the Access tab locks rather than inviting
 * work the server (the real gate) will refuse.
 */
export function useCustomRbacEntitled(): boolean {
  const usageResult = sdk.organizations.usage();
  return usageResult.data?.tier?.entitlements?.customRbac ?? false;
}

import type { BuiltinToolpackSlug } from "@portalai/core/registries";

/**
 * A station every new or reset organization is provisioned with (#848).
 *
 * `ApplicationService.provisionOrganizationWorkspace` creates one station per
 * entry, in order, owned by the system principal (a provisioned default,
 * #641). Each is scoped to one kind of work, which is the practice the help
 * content describes with these two as its examples. Both also carry the
 * Help pack (#1044), so a new user can ask how Portals works wherever they
 * start; it's always entitled (#1050), so it's active on every tier.
 *
 * Provisioning does not check the tier: a pack the plan lacks is attached all
 * the same and shows as inactive.
 */
export interface ProvisionedStation {
  name: string;
  /** States the station's purpose; shown on the station and in the picker. */
  description: string;
  builtinSlugs: readonly BuiltinToolpackSlug[];
  /** Attach the organization's Sandbox connector instance. */
  attachSandbox: boolean;
  /** The organization's `defaultStationId`. Exactly one entry sets it. */
  isDefault: boolean;
}

export const PROVISIONED_STATIONS: readonly ProvisionedStation[] = [
  {
    name: "Administrate",
    description:
      "Manage members and access through the assistant: invitations, members and shares on any plan, and custom roles, policies and groups where your plan includes them. No data is attached here. You can also ask how Portals works.",
    builtinSlugs: ["rbac_management", "member_management", "help"],
    attachSandbox: false,
    isDefault: true,
  },
  {
    name: "Playground",
    description:
      "Build and share entities and views with the assistant, attach views to this or other stations, and query the data in the same session. You can also ask how Portals works.",
    builtinSlugs: [
      "data_query",
      "entity_management",
      "view_management",
      "help",
    ],
    attachSandbox: true,
    isDefault: false,
  },
];

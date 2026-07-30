export enum ApplicationRoute {
  Dashboard = "/",
  Settings = "/settings",
  Login = "/login",
  Connectors = "/connectors",
  ConnectorInstance = "/connectors/$connectorInstanceId",
  Entities = "/entities",
  Entity = "/entities/$entityId",
  EntityRecord = "/entities/$entityId/records/$recordId",
  ColumnDefinitions = "/column-definitions",
  ColumnDefinition = "/column-definitions/$columnDefinitionId",
  EntityGroups = "/entity-groups",
  EntityGroup = "/entity-groups/$entityGroupId",
  Jobs = "/jobs",
  Tags = "/tags",
  Portal = "/portals/$portalId",
  Stations = "/stations",
  StationDetail = "/stations/$stationId",
  Toolpacks = "/toolpacks",
  PortalResults = "/portal-results",
  Help = "/help",
}

// ── Settings tabs (#284) ─────────────────────────────────────────────
//
// `/settings` renders three tabs with local state. Entitlement
// affordances elsewhere in the app need to land the user on the billing
// tab specifically — a link that names a plan limit and then opens the
// General tab is not an upgrade path — so the tab becomes addressable
// via `?tab=`.

export enum SettingsTab {
  Profile = "profile",
  Organization = "organization",
  Billing = "billing",
}

/** Tab order as rendered by `Settings.view.tsx`. */
export const SETTINGS_TAB_INDEX: Record<SettingsTab, number> = {
  [SettingsTab.Profile]: 0,
  [SettingsTab.Organization]: 1,
  [SettingsTab.Billing]: 2,
};

/**
 * Resolve a `?tab=` value from a location search string to a tab index.
 * Anything absent or unrecognized falls back to the first tab.
 */
export function settingsTabIndexFromSearch(search: string): number {
  const tab = new URLSearchParams(search).get("tab");
  if (!tab) return 0;
  return SETTINGS_TAB_INDEX[tab as SettingsTab] ?? 0;
}

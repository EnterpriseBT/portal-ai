import { createContext, useContext } from "react";

import type { SettingsTab } from "./routes.util";

/**
 * #691: switches the Settings tab from inside Settings.
 *
 * Settings reads `?tab=` once, at mount (the read-once shape, see `CLAUDE.md`
 * → Addressable sections), so navigating to `/settings?tab=billing` from a
 * Settings tab changes the URL and leaves the tab where it was. The upgrade
 * affordances inside Settings (the seat-cap Invite upsell, the Access tab's
 * "View plans") use this instead when it's provided; outside Settings it's
 * null and they navigate as usual.
 */
export const SettingsTabSwitchContext = createContext<
  ((tab: SettingsTab) => void) | null
>(null);

export const useSettingsTabSwitch = () => useContext(SettingsTabSwitchContext);

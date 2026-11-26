import { createContext, useContext } from "react";

import type { PortalLauncher } from "./use-portal-launcher.util";

/**
 * The caller's latest portals, newest first: the launcher reads the first
 * one's station, and the command palette lists them as "Recent portals".
 * One query (one cache key) serves both (#1076 code review).
 */
export const RECENT_PORTALS_PARAMS = {
  limit: 5,
  offset: 0,
  sortBy: "lastOpened",
  sortOrder: "desc",
  mine: "true",
} as const;

/**
 * #1076: one portal launcher for the whole authorized shell, so the header's
 * Open Portal button and the command palette share a single create (one
 * in-flight dedupe, one pending state) and a single chooser dialog.
 */
export const PortalLauncherContext = createContext<PortalLauncher | null>(null);

export function usePortalLauncherContext(): PortalLauncher {
  const launcher = useContext(PortalLauncherContext);
  if (!launcher) {
    throw new Error(
      "usePortalLauncherContext must be used within a PortalLauncherProvider"
    );
  }
  return launcher;
}

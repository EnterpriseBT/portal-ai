import { createContext, useContext } from "react";

import type { PortalLauncher } from "./use-portal-launcher.util";

/**
 * #1076: one portal launcher for the whole authorized shell, so the header's
 * New portal button and the command palette share a single create (one
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

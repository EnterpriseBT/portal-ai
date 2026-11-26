import React from "react";

import { PortalLauncherContext } from "../utils/portal-launcher.context";
import { usePortalLauncher } from "../utils/use-portal-launcher.util";

/** #1076: runs the shell's one portal launcher; see `portal-launcher.context`. */
export const PortalLauncherProvider = ({
  children,
}: {
  children: React.ReactNode;
}) => {
  const launcher = usePortalLauncher();
  return (
    <PortalLauncherContext.Provider value={launcher}>
      {children}
    </PortalLauncherContext.Provider>
  );
};

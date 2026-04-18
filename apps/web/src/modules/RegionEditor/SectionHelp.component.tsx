import React from "react";
import { Icon, IconName, Tooltip } from "@portalai/core/ui";

export interface SectionHelpUIProps {
  /** Tooltip body — rendered inside the MUI Tooltip. */
  title: React.ReactNode;
  /** aria-label for the icon trigger (screen readers). */
  ariaLabel: string;
}

export const SectionHelpUI: React.FC<SectionHelpUIProps> = ({ title, ariaLabel }) => (
  <Tooltip arrow title={title}>
    <Icon
      name={IconName.HelpOutline}
      fontSize="inherit"
      sx={{ fontSize: 14, color: "text.secondary", cursor: "help" }}
      aria-label={ariaLabel}
    />
  </Tooltip>
);

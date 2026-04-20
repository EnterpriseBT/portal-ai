import React, { useCallback } from "react";

import { IconButton, IconName } from "@portalai/core/ui";

import { useLayout } from "../utils";

export interface SidebarNavToggleProps {
  collapsed: boolean;
  collapsedIcon?: IconName;
  expandedIcon?: IconName;
  variant: "full" | "compact";
  onClick: () => void;
}

export const SidebarNavToggleUI = ({
  variant,
  collapsed,
  collapsedIcon = IconName.KeyboardArrowRight,
  expandedIcon = IconName.KeyboardArrowLeft,
  onClick,
}: SidebarNavToggleProps) => {
  return (
    <IconButton
      aria-label="toggle sidebar"
      color="inherit"
      onClick={onClick}
      size="small"
      sx={(theme) => ({
        width: variant === "full" ? theme.spacing(4) : theme.spacing(2),
        height: 32,
      })}
      icon={collapsed ? collapsedIcon : expandedIcon}
    />
  );
};

/**
 * On mobile, the sidebar's ClickAwayListener listens for click/touchend
 * on the document. When this toggle lives *outside* the sidebar (e.g. in the
 * AppBar), tapping it fires ClickAwayListener (close) then onClick (reopen).
 * We stop propagation of those events so the ClickAwayListener never sees them.
 */
export const SidebarNavToggle = () => {
  const { isMobile, isCollapsed, toggle } = useLayout();

  const stopClickAwayEvents = useCallback(
    (e: React.MouseEvent | React.TouchEvent) => {
      if (isMobile) e.stopPropagation();
    },
    [isMobile]
  );

  return (
    <span onClick={stopClickAwayEvents} onTouchEnd={stopClickAwayEvents}>
      <SidebarNavToggleUI
        variant={isMobile ? "full" : "compact"}
        collapsed={isCollapsed}
        collapsedIcon={isMobile ? IconName.Menu : undefined}
        expandedIcon={isMobile ? IconName.Close : undefined}
        onClick={() => toggle()}
      />
    </span>
  );
};

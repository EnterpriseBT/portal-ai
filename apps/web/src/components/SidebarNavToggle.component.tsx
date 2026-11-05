import React, { useCallback } from "react";

import { IconButton, IconName } from "@portalai/core/ui";

import { useLayout } from "../utils";

export interface SidebarNavToggleProps {
  collapsed: boolean;
  collapsedIcon?: IconName;
  expandedIcon?: IconName;
  variant: "full" | "compact";
  onClick: () => void;
  /** The id of the navigation this toggle shows and hides. Only set where
   *  that element exists, or aria-controls would dangle. */
  controlsId?: string;
}

/** WCAG 2.5.8: a pointer target is at least 24×24 CSS px. */
export const MIN_TARGET_PX = 24;

/** The toggle's visible width for a variant. */
const visibleWidth = (
  variant: "full" | "compact",
  spacing: (n: number) => string
): string => (variant === "full" ? spacing(4) : spacing(2));

/**
 * The width the toggle answers clicks over: its visible width, widened by an
 * invisible ::after to MIN_TARGET_PX when narrower (the compact toggle is
 * 16 px wide on the drawer edge, #797 KB-06).
 */
export function toggleTargetWidth(
  variant: "full" | "compact",
  spacing: (n: number) => string
): number {
  return Math.max(parseFloat(visibleWidth(variant, spacing)), MIN_TARGET_PX);
}

export const SidebarNavToggleUI = ({
  variant,
  collapsed,
  collapsedIcon = IconName.KeyboardArrowRight,
  expandedIcon = IconName.KeyboardArrowLeft,
  onClick,
  controlsId,
}: SidebarNavToggleProps) => {
  return (
    <IconButton
      aria-label="toggle sidebar"
      aria-expanded={!collapsed}
      aria-controls={controlsId}
      color="inherit"
      onClick={onClick}
      size="small"
      sx={(theme) => {
        const visible = parseFloat(visibleWidth(variant, theme.spacing));
        const extra = Math.max(0, MIN_TARGET_PX - visible) / 2;
        return {
          width: visibleWidth(variant, theme.spacing),
          height: 32,
          position: "relative",
          ...(extra > 0 && {
            "&::after": {
              content: '""',
              position: "absolute",
              top: 0,
              bottom: 0,
              left: -extra,
              right: -extra,
            },
          }),
        };
      }}
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
    // Only stops the click reaching the drawer's ClickAwayListener; the
    // button inside is the control.
    <span
      role="presentation"
      onClick={stopClickAwayEvents}
      onTouchEnd={stopClickAwayEvents}
    >
      <SidebarNavToggleUI
        variant={isMobile ? "full" : "compact"}
        collapsed={isCollapsed}
        collapsedIcon={isMobile ? IconName.Menu : undefined}
        expandedIcon={isMobile ? IconName.Close : undefined}
        onClick={() => toggle()}
        controlsId="primary-nav"
      />
    </span>
  );
};

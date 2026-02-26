import { useContext } from "react";
import { Breakpoints, useMediaQuery } from "@mui/material";
import { usePersistedTheme } from "./theme.util";
import {
  LayoutContext,
  LayoutContextValue,
} from "../providers/Layout.provider";

export interface LayoutApi extends LayoutContextValue {
  isCollapsed: boolean;
  isExpanded: boolean;
  isExpandedActive: boolean;
  isExpandedPassive: boolean;
  breakpoints: Breakpoints;
  isMobile: boolean;
  isTablet: boolean;
  isDesktop: boolean;
  isMobileCollapsed: boolean;
  isMobileExpanded: boolean;
  isTabletCollapsed: boolean;
  isTabletExpanded: boolean;
  isDesktopCollapsed: boolean;
  isDesktopExpanded: boolean;
  isMobileExpandedActive: boolean;
  isMobileExpandedPassive: boolean;
  isTabletExpandedActive: boolean;
  isTabletExpandedPassive: boolean;
  isDesktopExpandedActive: boolean;
  isDesktopExpandedPassive: boolean;
  toggle: (options?: { active: boolean }) => void;
}

export const useLayout = (): LayoutApi => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error("useLayout must be used within a LayoutProvider");
  }

  const { theme } = usePersistedTheme();
  const { breakpoints } = theme;

  const isMobile = useMediaQuery(breakpoints.down("sm"));
  const isTablet = useMediaQuery(breakpoints.between("sm", "md"));
  const isDesktop = useMediaQuery(breakpoints.up("md"));

  const { isCollapsed, isExpanded, isExpandedActive, isExpandedPassive } =
    context;

  const toggle = (options: { active: boolean } = { active: true }) => {
    if (isCollapsed) {
      context.setSidebarState(
        options.active ? "expanded:active" : "expanded:passive"
      );
    } else {
      context.setSidebarState("collapsed");
    }
  };

  return {
    ...context,
    toggle,
    breakpoints,
    isMobile,
    isTablet,
    isDesktop,
    isCollapsed,
    isExpanded,
    isExpandedActive,
    isExpandedPassive,
    isMobileCollapsed: isMobile && isCollapsed,
    isMobileExpanded: isMobile && isExpanded,
    isTabletCollapsed: isTablet && isCollapsed,
    isTabletExpanded: isTablet && isExpanded,
    isDesktopCollapsed: isDesktop && isCollapsed,
    isDesktopExpanded: isDesktop && isExpanded,
    isMobileExpandedActive: isMobile && isExpandedActive,
    isMobileExpandedPassive: isMobile && isExpandedPassive,
    isTabletExpandedActive: isTablet && isExpandedActive,
    isTabletExpandedPassive: isTablet && isExpandedPassive,
    isDesktopExpandedActive: isDesktop && isExpandedActive,
    isDesktopExpandedPassive: isDesktop && isExpandedPassive,
  };
};

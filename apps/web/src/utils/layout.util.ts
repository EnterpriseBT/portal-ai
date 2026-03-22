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
  toggle: () => void;
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

  const { isCollapsed, isExpanded } = context;

  const toggle = () => {
    context.setSidebarState(isCollapsed ? "expanded" : "collapsed");
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
    isMobileCollapsed: isMobile && isCollapsed,
    isMobileExpanded: isMobile && isExpanded,
    isTabletCollapsed: isTablet && isCollapsed,
    isTabletExpanded: isTablet && isExpanded,
    isDesktopCollapsed: isDesktop && isCollapsed,
    isDesktopExpanded: isDesktop && isExpanded,
  };
};

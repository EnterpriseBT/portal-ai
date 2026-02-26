import React, { createContext } from "react";
import { useStorage } from "../utils/storage.util";

export type SidebarState = "collapsed" | "expanded:active" | "expanded:passive";

export const SIDEBAR_STATES: SidebarState[] = [
  "collapsed",
  "expanded:active",
  "expanded:passive",
];

const isSidebarState = (value: unknown): value is SidebarState =>
  typeof value === "string" && SIDEBAR_STATES.includes(value as SidebarState);

export interface LayoutContextValue {
  sidebarState: SidebarState;
  isCollapsed: boolean;
  isExpanded: boolean;
  isExpandedActive: boolean;
  isExpandedPassive: boolean;
  setSidebarState: (value: SidebarState) => void;
}

export const LayoutContext = createContext<LayoutContextValue | null>(null);

export const LayoutProvider = ({ children }: { children: React.ReactNode }) => {
  const { value: sidebarState, setValue: setSidebarState } =
    useStorage<SidebarState>({
      key: "sidebar-state",
      defaultValue: "collapsed",
      validator: isSidebarState,
    });

  const isCollapsed = sidebarState === "collapsed";
  const isExpanded = sidebarState !== "collapsed";
  const isExpandedActive = sidebarState === "expanded:active";
  const isExpandedPassive = sidebarState === "expanded:passive";

  return (
    <LayoutContext.Provider
      value={{
        sidebarState,
        setSidebarState,
        isCollapsed,
        isExpanded,
        isExpandedActive,
        isExpandedPassive,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
};

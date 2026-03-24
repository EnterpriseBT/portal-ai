import React from "react";
import {
  Box,
  Drawer,
  Divider,
  ClickAwayListener,
  IconName,
} from "@portalai/core/ui";
import { useLayout } from "../utils";
import { SidebarNavItem } from "./SidebarNavItem.component";
import { useRouter } from "@tanstack/react-router";
import { ApplicationRoute } from "../utils/routes.util";
import { sdk } from "../api/sdk";
import { SidebarNavToggle } from "./SidebarNavToggle.component";

export interface SidebarNavUIProps {
  collapsed: boolean;
  hidden: boolean;
  children?: React.ReactNode;
  showSideBarToggle?: boolean;
  frozen?: boolean;
  footer?: React.ReactNode | (() => React.ReactNode);
  onClickAway?: () => void;
}

export const SidebarNavUI = ({
  collapsed,
  hidden,
  children,
  footer,
  showSideBarToggle = true,
  frozen = false,
  onClickAway,
}: SidebarNavUIProps) => {
  const resolvedFooter = typeof footer === "function" ? footer() : footer;

  const drawer = (
    <Box
      sx={{
        position: "relative",
        display: hidden ? "none" : "block",
      }}
    >
      <Drawer
        variant="permanent"
        open={!collapsed}
        sx={() => ({
          height: "100%",
          "& .MuiDrawer-paper": {
            overflowY: "unset",
            position: frozen ? "absolute" : "relative",
            boxSizing: "border-box",
            width: frozen ? "85vw" : undefined,
            transition: (theme) =>
              theme.transitions.create("width", {
                easing: theme.transitions.easing.sharp,
                duration: collapsed
                  ? theme.transitions.duration.leavingScreen
                  : theme.transitions.duration.enteringScreen,
              }),
          },
        })}
      >
        <Box
          sx={() => ({
            display: "flex",
            flexDirection: "column",
            justifyContent: "space-between",
            height: "100%",
          })}
        >
          <Box sx={{ flex: 1, overflowY: "auto", marginTop: 0 }}>
            {children}
          </Box>
          {resolvedFooter && (
            <>
              <Divider />
              <Box sx={{ flexShrink: 0 }}>{resolvedFooter}</Box>
            </>
          )}
        </Box>
      </Drawer>
      {showSideBarToggle && (
        <Box
          sx={{
            display: "inline",
            position: "absolute",
            top: "50%",
            right: 0,
            translate: "50% -50%",
            zIndex: 1300,
          }}
        >
          <Box
            sx={(theme) => ({
              border: `1px solid ${theme.palette.divider}`,
              borderRadius: theme.shape.borderRadius,
              background: theme.palette.background.paper,
            })}
          >
            <SidebarNavToggle />
          </Box>
        </Box>
      )}
    </Box>
  );

  if (onClickAway) {
    return (
      <ClickAwayListener onClickAway={onClickAway}>{drawer}</ClickAwayListener>
    );
  }

  return drawer;
};

export const SidebarNav = () => {
  const { isMobile, isCollapsed, isMobileExpanded, isMobileCollapsed, toggle } =
    useLayout();
  const router = useRouter();
  const { logout } = sdk.auth.logout();
  const pathname = router.state.location.pathname;
  const handleClick = (path: string) => {
    if (isMobileExpanded) toggle();
    router.navigate({ to: path });
  };
  return (
    <SidebarNavUI
      collapsed={isCollapsed}
      hidden={isMobileCollapsed}
      frozen={isMobileExpanded}
      showSideBarToggle={!isMobile}
      onClickAway={isMobileExpanded ? toggle : undefined}
      footer={
        <>
          <SidebarNavItem
            icon={IconName.Settings}
            label="Settings"
            selected={pathname === ApplicationRoute.Settings}
            onClick={() => handleClick(ApplicationRoute.Settings)}
          />
          <SidebarNavItem
            icon={IconName.Logout}
            label="Logout"
            onClick={logout}
          />
        </>
      }
    >
      <SidebarNavItem
        icon={IconName.Home}
        label="Dashboard"
        selected={pathname === ApplicationRoute.Dashboard}
        onClick={() => handleClick(ApplicationRoute.Dashboard)}
      />
      <SidebarNavItem
        icon={IconName.MemoryChip}
        label="Connectors"
        selected={pathname === ApplicationRoute.Connectors}
        onClick={() => handleClick(ApplicationRoute.Connectors)}
      />
      <SidebarNavItem
        icon={IconName.DataObject}
        label="Entities"
        selected={pathname.startsWith(ApplicationRoute.Entities)}
        onClick={() => handleClick(ApplicationRoute.Entities)}
      />
      <SidebarNavItem
        icon={IconName.Hub}
        label="Entity Groups"
        selected={pathname.startsWith(ApplicationRoute.EntityGroups)}
        onClick={() => handleClick(ApplicationRoute.EntityGroups)}
      />
      <SidebarNavItem
        icon={IconName.Label}
        label="Tags"
        selected={pathname.startsWith(ApplicationRoute.Tags)}
        onClick={() => handleClick(ApplicationRoute.Tags)}
      />
      <SidebarNavItem
        icon={IconName.ViewColumn}
        label="Column Definitions"
        selected={pathname.startsWith(ApplicationRoute.ColumnDefinitions)}
        onClick={() => handleClick(ApplicationRoute.ColumnDefinitions)}
      />
      <SidebarNavItem
        icon={IconName.Work}
        label="Jobs"
        selected={pathname.startsWith(ApplicationRoute.Jobs)}
        onClick={() => handleClick(ApplicationRoute.Jobs)}
      />
    </SidebarNavUI>
  );
};

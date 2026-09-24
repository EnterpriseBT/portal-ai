import React, { useState } from "react";
import {
  Box,
  Drawer,
  Divider,
  ClickAwayListener,
  IconName,
  Typography,
} from "@portalai/core/ui";
import Dialog from "@mui/material/Dialog";
import DialogContent from "@mui/material/DialogContent";
import type { NavPageId } from "@portalai/core/models";
import { useLayout } from "../utils";
import { useCapabilities } from "../utils/use-capabilities.util";
import { SidebarNavItem } from "./SidebarNavItem.component";
import { useRouter } from "@tanstack/react-router";
import { ApplicationRoute } from "../utils/routes.util";
import { sdk } from "../api/sdk";
import { SidebarNavToggle } from "./SidebarNavToggle.component";

/**
 * The main sidebar nav, as data (#630). Each item is gated on `pageIds`: the
 * item renders when the caller may `view` **any** of them (so a role granted
 * only `connector_catalog` still sees Connectors). An item with no `pageIds`
 * (Dashboard) is always shown — it is the un-gated safe landing. `match` mirrors
 * the pre-#630 selection logic (Dashboard + Connectors matched exactly, the rest
 * by prefix). Footer items (Settings/Help/Logout) are never gated.
 */
export interface SidebarNavItemDef {
  route: ApplicationRoute;
  label: string;
  icon: IconName;
  match: "exact" | "prefix";
  pageIds?: readonly NavPageId[];
}

export const NAV_ITEMS: readonly SidebarNavItemDef[] = [
  {
    route: ApplicationRoute.Dashboard,
    label: "Dashboard",
    icon: IconName.Home,
    match: "exact",
  },
  {
    route: ApplicationRoute.Stations,
    label: "Stations",
    icon: IconName.SatelliteAlt,
    match: "prefix",
    pageIds: ["stations"],
  },
  {
    route: ApplicationRoute.Toolpacks,
    label: "Toolpacks",
    icon: IconName.Extension,
    match: "prefix",
    pageIds: ["toolpacks"],
  },
  {
    route: ApplicationRoute.Connectors,
    label: "Connectors",
    icon: IconName.MemoryChip,
    match: "exact",
    pageIds: ["connectors", "connector_catalog"],
  },
  {
    route: ApplicationRoute.Entities,
    label: "Entities",
    icon: IconName.DataObject,
    match: "prefix",
    pageIds: ["entities"],
  },
  {
    route: ApplicationRoute.EntityGroups,
    label: "Entity Groups",
    icon: IconName.Hub,
    match: "prefix",
    pageIds: ["entity_groups"],
  },
  {
    route: ApplicationRoute.Tags,
    label: "Tags",
    icon: IconName.Label,
    match: "prefix",
    pageIds: ["tags"],
  },
  {
    route: ApplicationRoute.ColumnDefinitions,
    label: "Column Definitions",
    icon: IconName.ViewColumn,
    match: "prefix",
    pageIds: ["column_definitions"],
  },
  {
    route: ApplicationRoute.Jobs,
    label: "Jobs",
    icon: IconName.Work,
    match: "prefix",
    pageIds: ["jobs"],
  },
  {
    route: ApplicationRoute.PortalResults,
    label: "Pinned Results",
    icon: IconName.PushPin,
    match: "prefix",
    pageIds: ["pinned"],
  },
];

/** The nav items the caller may see, given a `canViewPage` predicate (#630).
 *  Pure — unit-tested directly, no render. */
export function visibleNavItems(
  canViewPage: (pageId: NavPageId) => boolean
): SidebarNavItemDef[] {
  return NAV_ITEMS.filter(
    (item) => !item.pageIds || item.pageIds.some(canViewPage)
  );
}

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
  const { canViewPage } = useCapabilities();
  const { logout } = sdk.auth.logout();
  const [versionOpen, setVersionOpen] = useState(false);
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
            icon={IconName.HelpOutline}
            label="Help"
            selected={pathname.startsWith(ApplicationRoute.Help)}
            onClick={() => handleClick(ApplicationRoute.Help)}
          />
          <SidebarNavItem
            icon={IconName.Logout}
            label="Logout"
            onClick={logout}
          />
          <Typography
            variant="caption"
            color="text.secondary"
            onClick={() => setVersionOpen(true)}
            sx={{
              display: "block",
              textAlign: "center",
              py: 0.5,
              px: 1,
              fontSize: "0.65rem",
              cursor: "pointer",
              "&:hover": { textDecoration: "underline" },
            }}
          >
            {isCollapsed
              ? `\u00A9 ${new Date().getFullYear()}`
              : `Portalsai \u00A9 ${new Date().getFullYear()}`}
          </Typography>
          <Dialog
            open={versionOpen}
            onClose={() => setVersionOpen(false)}
            maxWidth="xs"
          >
            <DialogContent>
              <Typography variant="body2" sx={{ mb: 1, textAlign: "center" }}>
                App version
              </Typography>
              <Box
                component="code"
                sx={(theme) => ({
                  display: "block",
                  wordBreak: "break-all",
                  // eslint-disable-next-line @typescript-eslint/no-explicit-any
                  fontFamily: (theme.typography as any).code?.fontFamily,
                  fontSize: "0.75rem",
                  backgroundColor: theme.palette.action.hover,
                  borderRadius: 1,
                  px: 1.5,
                  py: 1,
                })}
              >
                {import.meta.env?.VITE_APP_VERSION ?? "dev"} (
                {import.meta.env?.VITE_APP_SHA ?? "local"})
              </Box>
            </DialogContent>
          </Dialog>
        </>
      }
    >
      {visibleNavItems(canViewPage).map((item) => (
        <SidebarNavItem
          key={item.route}
          icon={item.icon}
          label={item.label}
          selected={
            item.match === "exact"
              ? pathname === item.route
              : pathname.startsWith(item.route)
          }
          onClick={() => handleClick(item.route)}
        />
      ))}
    </SidebarNavUI>
  );
};

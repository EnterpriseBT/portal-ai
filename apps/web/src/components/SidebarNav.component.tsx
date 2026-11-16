import React, { useState } from "react";
import {
  Box,
  Drawer,
  Divider,
  ClickAwayListener,
  IconName,
  Modal,
} from "@portalai/core/ui";
import type { NavPageId } from "@portalai/core/models";
import { NAV_PAGE_IDS } from "@portalai/core/models";
import { useLayout } from "../utils";
import { useCapabilities } from "../utils/use-capabilities.util";
import { SidebarNavItem } from "./SidebarNavItem.component";
import { SidebarVersionCaptionUI } from "./SidebarVersionCaption.component";
import { useRouter } from "@tanstack/react-router";
import { ApplicationRoute } from "../utils/routes.util";
import { sdk } from "../api/sdk";
import { SidebarNavToggle } from "./SidebarNavToggle.component";

export interface SidebarNavItemDef {
  route: ApplicationRoute;
  label: string;
  icon: IconName;
  match: "exact" | "prefix";
  /** The page id this item gates on (undefined = always shown, Dashboard). */
  pageId?: NavPageId;
}

/**
 * Nav metadata for **every** gated page, keyed by `NavPageId` (#630). This is the
 * **single source of truth**: the `Record<NavPageId, …>` type makes adding a page
 * to `NAV_PAGE_IDS` (core) a **compile error** here until its nav entry exists, so
 * a new page can't be silently missed. One id **per page** — a page's tabs/lists
 * are gated by object `read`, not page ids. `match` mirrors the pre-#630 selection
 * logic (Connectors matched exactly, the rest by prefix).
 */
const PAGE_NAV: Record<NavPageId, Omit<SidebarNavItemDef, "pageId">> = {
  stations: {
    route: ApplicationRoute.Stations,
    label: "Stations",
    icon: IconName.SatelliteAlt,
    match: "prefix",
  },
  pinned: {
    route: ApplicationRoute.PortalResults,
    label: "Pinned Results",
    icon: IconName.PushPin,
    match: "prefix",
  },
  jobs: {
    route: ApplicationRoute.Jobs,
    label: "Jobs",
    icon: IconName.Work,
    match: "prefix",
  },
  connectors: {
    route: ApplicationRoute.Connectors,
    label: "Connectors",
    icon: IconName.MemoryChip,
    match: "exact",
  },
  entities: {
    route: ApplicationRoute.Entities,
    label: "Entities",
    icon: IconName.DataObject,
    match: "prefix",
  },
  entity_groups: {
    route: ApplicationRoute.EntityGroups,
    label: "Entity Groups",
    icon: IconName.Hub,
    match: "prefix",
  },
  tags: {
    route: ApplicationRoute.Tags,
    label: "Tags",
    icon: IconName.Label,
    match: "prefix",
  },
  column_definitions: {
    route: ApplicationRoute.ColumnDefinitions,
    label: "Column Definitions",
    icon: IconName.ViewColumn,
    match: "prefix",
  },
  toolpacks: {
    route: ApplicationRoute.Toolpacks,
    label: "Toolpacks",
    icon: IconName.Extension,
    match: "prefix",
  },
  views: {
    route: ApplicationRoute.CuratedViews,
    label: "Views",
    icon: IconName.Layers,
    match: "prefix",
  },
};

/** The full ordered nav: the un-gated Dashboard, then every page in
 *  `NAV_PAGE_IDS` order — derived, so no page is ever hand-missed. */
export const NAV_ITEMS: readonly SidebarNavItemDef[] = [
  {
    route: ApplicationRoute.Dashboard,
    label: "Dashboard",
    icon: IconName.Home,
    match: "exact",
  },
  ...NAV_PAGE_IDS.map((pageId) => ({ pageId, ...PAGE_NAV[pageId] })),
];

/** The nav items the caller may see, given a `canViewPage` predicate (#630).
 *  Pure — unit-tested directly, no render. */
export function visibleNavItems(
  canViewPage: (pageId: NavPageId) => boolean
): SidebarNavItemDef[] {
  return NAV_ITEMS.filter((item) => !item.pageId || canViewPage(item.pageId));
}

export interface SidebarNavUIProps {
  collapsed: boolean;
  hidden: boolean;
  children?: React.ReactNode;
  showSideBarToggle?: boolean;
  frozen?: boolean;
  footer?: React.ReactNode | (() => React.ReactNode);
  onClickAway?: () => void;
  /** Escape pressed inside the drawer (#797): closes the mobile overlay. */
  onEscape?: () => void;
}

export const SidebarNavUI = ({
  collapsed,
  hidden,
  children,
  footer,
  showSideBarToggle = true,
  frozen = false,
  onClickAway,
  onEscape,
}: SidebarNavUIProps) => {
  const resolvedFooter = typeof footer === "function" ? footer() : footer;

  // React bubbles keys through portals, so a dialog the drawer opened (the
  // app version) would reach here; only an Escape from the drawer's own DOM
  // closes it.
  const handleKeyDown = (e: React.KeyboardEvent<HTMLElement>) => {
    if (e.key !== "Escape" || e.defaultPrevented || !onEscape) return;
    if (!e.currentTarget.contains(e.target as Node)) return;
    onEscape();
  };

  const drawer = (
    <Box
      onKeyDown={handleKeyDown}
      sx={{
        position: "relative",
        display: hidden ? "none" : "block",
      }}
    >
      <Drawer
        variant="permanent"
        open={!collapsed}
        // The primary navigation landmark (#797); the toggle controls it.
        slotProps={{
          paper: {
            component: "nav",
            id: "primary-nav",
            "aria-label": "Primary",
          } as React.HTMLAttributes<HTMLElement>,
        }}
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

/** The brand themes register a `typography.code` variant that MUI's types
 *  don't declare (as `sandbox-theme.util.ts` does for `monospace`). */
interface CodeTypography {
  code?: { fontFamily?: string };
}

export const SidebarNav = () => {
  const { isMobile, isCollapsed, isMobileExpanded, isMobileCollapsed, toggle } =
    useLayout();
  const router = useRouter();
  const { canViewPage } = useCapabilities();
  const { logout } = sdk.auth.logout();
  const [versionOpen, setVersionOpen] = useState(false);
  const pathname = router.state.location.pathname;
  // Items are links (#797): the router navigates; this only closes the
  // mobile drawer on the way.
  const handleClick = () => {
    if (isMobileExpanded) toggle();
  };
  // Escape closes the mobile overlay and returns focus to the header toggle
  // that opened it, rather than leaving it in the hidden drawer.
  const closeFromKeyboard = () => {
    toggle();
    document
      .querySelector<HTMLElement>('button[aria-controls="primary-nav"]')
      ?.focus();
  };
  return (
    <SidebarNavUI
      collapsed={isCollapsed}
      hidden={isMobileCollapsed}
      frozen={isMobileExpanded}
      showSideBarToggle={!isMobile}
      onClickAway={isMobileExpanded ? toggle : undefined}
      onEscape={isMobileExpanded ? closeFromKeyboard : undefined}
      footer={
        <>
          <SidebarNavItem
            icon={IconName.Settings}
            label="Settings"
            href={ApplicationRoute.Settings}
            selected={pathname === ApplicationRoute.Settings}
            onClick={handleClick}
          />
          <SidebarNavItem
            icon={IconName.HelpOutline}
            label="Help"
            href={ApplicationRoute.Help}
            selected={pathname.startsWith(ApplicationRoute.Help)}
            onClick={handleClick}
          />
          <SidebarNavItem
            icon={IconName.Logout}
            label="Logout"
            onClick={logout}
          />
          <SidebarVersionCaptionUI
            collapsed={isCollapsed}
            year={new Date().getFullYear()}
            onClick={() => setVersionOpen(true)}
          />
          <Modal
            open={versionOpen}
            onClose={() => setVersionOpen(false)}
            title="App version"
            maxWidth="xs"
          >
            {/* #983: the title names the dialog, and Modal's close button
                gives keyboard and switch users a control to land on. */}
            <Box
              component="code"
              sx={(theme) => ({
                display: "block",
                wordBreak: "break-all",
                fontFamily: (theme.typography as unknown as CodeTypography).code
                  ?.fontFamily,
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
          </Modal>
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
          href={item.route}
          onClick={handleClick}
        />
      ))}
    </SidebarNavUI>
  );
};

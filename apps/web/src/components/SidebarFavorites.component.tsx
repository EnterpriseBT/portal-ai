import React, { useState } from "react";

import { useRouterState } from "@tanstack/react-router";

import { Divider, IconName, Typography } from "@portalai/core/ui";

import { sdk } from "../api/sdk";
import { SidebarNavItemUI } from "./SidebarNavItem.component";
import {
  LAUNCHER_TYPE_ICON,
  toLauncherItem,
  type LauncherItem,
  type LauncherItemType,
} from "../utils/launcher-items.util";
import { useStorage } from "../utils/storage.util";

export interface SidebarFavoritesUIProps {
  /** The caller's favorites, in the order to list them. */
  items: LauncherItem[];
  /** The sidebar is collapsed to icons. */
  collapsed: boolean;
  /** The group is expanded; remembering it is the wiring's job (#1077). */
  open: boolean;
  onToggle: () => void;
  /** The current page's path, to mark its favorite (`aria-current`). */
  activeHref?: string;
  /** How many to list before "Show all (n)". */
  limit?: number;
  /**
   * #1077: a favorite was followed. The sidebar closes its mobile drawer
   * here, as it does for its other links.
   */
  onNavigate?: () => void;
  /**
   * #1077: the favorites are still loading. With none loaded yet the group
   * shows no hint, rather than saying there are none.
   */
  loading?: boolean;
  /**
   * #1077: some or all favorites couldn't load. Shown in place of the empty
   * hint, and below the favorites that did load.
   */
  errorMessage?: string | null;
}

/**
 * The sidebar's Favorites group (#1122): a disclosure listing favorite
 * stations, pinned results, views and connectors as sidebar links with
 * their type icons. It lists `limit` of them, then "Show all (n)", which
 * expands in place. Collapsed to icons, the sidebar shows the first
 * `limit` as icons named by their tooltips. With none, it says how to add
 * some.
 */
export const SidebarFavoritesUI: React.FC<SidebarFavoritesUIProps> = ({
  items,
  collapsed,
  open,
  onToggle,
  activeHref,
  limit = 8,
  onNavigate,
  loading = false,
  errorMessage = null,
}) => {
  const [showAll, setShowAll] = useState(false);
  const capped = items.length > limit;
  const shown = showAll ? items : items.slice(0, limit);
  // The "none yet" hint only once the favorites have loaded without error;
  // until then it would say there are none.
  const showHint = items.length === 0 && !loading && !errorMessage;

  const links = (list: LauncherItem[]) =>
    list.map((item) => (
      <SidebarNavItemUI
        key={`${item.type}:${item.id}`}
        icon={LAUNCHER_TYPE_ICON[item.type]}
        label={item.name}
        href={item.href}
        collapsed={collapsed}
        selected={item.href === activeHref}
        iconColor="primary"
        nested
        onClick={onNavigate}
      />
    ));

  if (collapsed) {
    if (items.length === 0) return null;
    return (
      <>
        <Divider />
        {links(items.slice(0, limit))}
      </>
    );
  }

  return (
    <SidebarNavItemUI
      icon={IconName.Star}
      iconColor="favorite"
      label="Favorites"
      collapsed={false}
      open={open}
      onToggle={onToggle}
    >
      {showHint ? (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          // Indented with the entries; the theme holds the metrics.
          className="SidebarFavorites-hint"
        >
          Star a station, pinned result, view or connector to keep it here.
        </Typography>
      ) : (
        items.length > 0 && (
          <>
            {links(shown)}
            {capped && (
              // A sidebar item too, so it lines up with the favorites above.
              <SidebarNavItemUI
                icon={showAll ? IconName.ExpandLess : IconName.ExpandMore}
                label={showAll ? "Show fewer" : `Show all (${items.length})`}
                collapsed={false}
                nested
                onClick={() => setShowAll((all) => !all)}
              />
            )}
          </>
        )
      )}
      {errorMessage && (
        <Typography
          variant="caption"
          color="error"
          component="p"
          className="SidebarFavorites-hint"
        >
          {errorMessage}
        </Typography>
      )}
    </SidebarNavItemUI>
  );
};

// ── Container (#1077) ─────────────────────────────────────────────────

export interface SidebarFavoritesProps {
  /** The sidebar is collapsed to icons. */
  collapsed: boolean;
  /** A favorite was followed (the sidebar closes its mobile drawer). */
  onNavigate?: () => void;
}

/** Where the group's expanded state is remembered, per browser. */
export const SIDEBAR_FAVORITES_OPEN_KEY = "portalai-sidebar-favorites-open";

/** Per type; the list routes clamp `limit` at 100. */
const FAVORITES_PER_TYPE = 100;

const isBoolean = (value: unknown): value is boolean =>
  typeof value === "boolean";

const byName = (a: LauncherItem, b: LauncherItem) =>
  a.name.localeCompare(b.name, undefined, { sensitivity: "base" }) ||
  a.type.localeCompare(b.type) ||
  a.id.localeCompare(b.id);

/**
 * The sidebar's Favorites group, wired (#1077): the caller's favorite
 * stations, pinned results, views and connectors from the four
 * `favorite=true` lists, merged and sorted by name. Those lists return only
 * readable, undeleted rows, and a star or unstar anywhere refreshes them
 * (`favoriteKeys`), so the group follows without a reload. While they
 * load it shows no hint; a list that fails leaves its type out and the
 * group says some favorites couldn't load.
 */
export const SidebarFavorites: React.FC<SidebarFavoritesProps> = ({
  collapsed,
  onNavigate,
}) => {
  const page = {
    favorite: "true",
    limit: FAVORITES_PER_TYPE,
    offset: 0,
  } as const;
  const stations = sdk.stations.list({
    ...page,
    sortBy: "name",
    sortOrder: "asc",
  });
  const pins = sdk.portalResults.list(page);
  const views = sdk.curatedViews.list({
    ...page,
    sortBy: "label",
    sortOrder: "asc",
  });
  const connectors = sdk.connectorInstances.list({
    ...page,
    sortBy: "name",
    sortOrder: "asc",
  });

  const rows = (
    type: LauncherItemType,
    list: { id: string; name: string }[] | undefined
  ) =>
    (list ?? []).map((row) =>
      toLauncherItem({ type, id: row.id, name: row.name, tags: [] })
    );
  const items = [
    ...rows("station", stations.data?.stations),
    ...rows("pin", pins.data?.portalResults),
    ...rows(
      "curated_view",
      views.data?.curatedViews.map((v) => ({ id: v.id, name: v.label }))
    ),
    ...rows("connector_instance", connectors.data?.connectorInstances),
  ].sort(byName);

  const { value: open, setValue: setOpen } = useStorage<boolean>({
    key: SIDEBAR_FAVORITES_OPEN_KEY,
    defaultValue: true,
    validator: isBoolean,
  });

  // The location, not the match: the sidebar renders above every page.
  const pathname = useRouterState({ select: (s) => s.location.pathname });
  const activeHref = items.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`)
  )?.href;

  const lists = [stations, pins, views, connectors];
  return (
    <SidebarFavoritesUI
      items={items}
      loading={lists.some((list) => list.isLoading)}
      errorMessage={
        lists.some((list) => list.isError)
          ? "Some favorites couldn’t load."
          : null
      }
      collapsed={collapsed}
      open={open}
      onToggle={() => setOpen(!open)}
      activeHref={activeHref}
      onNavigate={onNavigate}
    />
  );
};

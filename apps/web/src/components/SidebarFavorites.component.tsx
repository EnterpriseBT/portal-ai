import React, { useState } from "react";

import { Divider, IconName, Typography } from "@portalai/core/ui";

import { SidebarNavItemUI } from "./SidebarNavItem.component";
import {
  LAUNCHER_TYPE_ICON,
  type LauncherItem,
} from "../utils/launcher-items.util";

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
}) => {
  const [showAll, setShowAll] = useState(false);
  const capped = items.length > limit;
  const shown = showAll ? items : items.slice(0, limit);

  const links = (list: LauncherItem[]) =>
    list.map((item) => (
      <SidebarNavItemUI
        key={`${item.type}:${item.id}`}
        icon={LAUNCHER_TYPE_ICON[item.type]}
        label={item.name}
        href={item.href}
        collapsed={collapsed}
        selected={item.href === activeHref}
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
      label="Favorites"
      collapsed={false}
      open={open}
      onToggle={onToggle}
    >
      {items.length === 0 ? (
        <Typography
          variant="caption"
          color="text.secondary"
          component="p"
          paddingX={3}
          paddingY={1}
        >
          Star a station, pinned result, view or connector to keep it here.
        </Typography>
      ) : (
        <>
          {links(shown)}
          {capped && (
            // A sidebar item too, so it lines up with the favorites above.
            <SidebarNavItemUI
              icon={showAll ? IconName.ExpandLess : IconName.ExpandMore}
              label={showAll ? "Show fewer" : `Show all (${items.length})`}
              collapsed={false}
              onClick={() => setShowAll((all) => !all)}
            />
          )}
        </>
      )}
    </SidebarNavItemUI>
  );
};

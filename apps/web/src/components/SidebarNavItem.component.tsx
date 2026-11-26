import React, { useState } from "react";
import { Link } from "@tanstack/react-router";
import {
  Icon,
  IconName,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  List,
  ClickAwayListener,
  Tooltip,
} from "@portalai/core/ui";
import { useLayout } from "../utils";

export interface SidebarNavChildItem {
  label: string;
  onClick?: () => void;
  selected?: boolean;
}

export interface SidebarNavItemUIProps {
  icon: IconName;
  label: string;
  /** The route this item goes to. With one, the item is a link (#797): it
   *  navigates, so it's announced as a link, opens in a new tab, and marks
   *  the current page. Without one (Logout, a parent) it stays a button. */
  href?: string;
  collapsed: boolean;
  children?: React.ReactNode;
  items?: SidebarNavChildItem[];
  onClick?: () => void;
  open?: boolean;
  onToggle?: () => void;
  onClose?: () => void;
  selected?: boolean;
  /**
   * What a selected link's `aria-current` says (#1077): `page` (the
   * default) when it's the page itself, `true` when it's the section the
   * page is under, so a favorite for that page can be the one current page.
   */
  current?: "page" | "true";
  /**
   * The icon's colour, from the theme (#1122). Nav items stay neutral; the
   * Favorites group's star takes `favorite` so it stands out, and its
   * entries take `primary`.
   */
  iconColor?: "favorite" | "primary";
  /**
   * An entry inside a group (a favorite under Favorites): indented, with a
   * smaller icon, so it reads as a level below the nav items. Collapsed to
   * icons, it isn't indented.
   */
  nested?: boolean;
}

export const SidebarNavItemUI = ({
  icon,
  label,
  href,
  collapsed,
  children,
  items,
  onClick,
  open = false,
  onToggle,
  onClose,
  selected = false,
  iconColor,
  nested = false,
  current = "page",
}: SidebarNavItemUIProps) => {
  const indented = nested && !collapsed;
  const hasChildren = Boolean(children) || Boolean(items?.length);

  const handleClick = () => {
    if (hasChildren) {
      onToggle?.();
    } else {
      onClick?.();
    }
  };

  const isLink = Boolean(href) && !hasChildren;
  const semantics = isLink
    ? {
        component: Link,
        to: href,
        "aria-current": selected ? current : undefined,
      }
    : hasChildren
      ? { "aria-expanded": open }
      : {};

  const item = (
    <ListItemButton
      {...semantics}
      // Collapsed, the label isn't rendered, so it names the item instead.
      aria-label={collapsed ? label : undefined}
      selected={selected}
      onClick={handleClick}
      // The row's metrics live in the theme (#1122): `SidebarNavItem`, and
      // `SidebarNavItem-nested` for an entry a level below.
      className={
        indented ? "SidebarNavItem SidebarNavItem-nested" : "SidebarNavItem"
      }
    >
      <ListItemIcon>
        <Icon
          name={icon}
          color={iconColor}
          fontSize={indented ? "small" : undefined}
        />
      </ListItemIcon>
      {/* A long name (a favorite's, #1122) truncates rather than wraps. */}
      {!collapsed && (
        <ListItemText
          primary={label}
          slotProps={{ primary: { noWrap: true } }}
        />
      )}
      {hasChildren && !collapsed && (
        <Icon name={open ? IconName.ExpandLess : IconName.ExpandMore} />
      )}
    </ListItemButton>
  );

  const button = collapsed ? (
    <Tooltip title={label} placement="right">
      {item}
    </Tooltip>
  ) : (
    item
  );

  const content = (
    <>
      {button}
      {hasChildren && (
        <Collapse in={open && !collapsed}>
          {/* A div, not a ul: its children are buttons, not list items. */}
          <List disablePadding component="div">
            {items?.map((item) => (
              <ListItemButton
                key={item.label}
                selected={item.selected}
                onClick={item.onClick}
                sx={{ pl: 4 }}
              >
                <ListItemText primary={item.label} />
              </ListItemButton>
            ))}
            {children}
          </List>
        </Collapse>
      )}
    </>
  );

  if (hasChildren) {
    return (
      <ClickAwayListener onClickAway={() => onClose?.()}>
        <div>{content}</div>
      </ClickAwayListener>
    );
  }

  return content;
};

export const SidebarNavItem = ({
  icon,
  label,
  href,
  children,
  items,
  onClick,
  selected,
  current,
}: Omit<
  SidebarNavItemUIProps,
  "collapsed" | "open" | "onToggle" | "onClose"
>) => {
  const { isCollapsed } = useLayout();
  const [open, setOpen] = useState(false);

  return (
    <SidebarNavItemUI
      icon={icon}
      label={label}
      href={href}
      collapsed={isCollapsed}
      open={open}
      onToggle={() => setOpen((prev) => !prev)}
      onClose={() => setOpen(false)}
      onClick={onClick}
      selected={selected}
      current={current}
      items={items}
    >
      {children}
    </SidebarNavItemUI>
  );
};

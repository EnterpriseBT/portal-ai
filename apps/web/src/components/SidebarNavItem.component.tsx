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
}: SidebarNavItemUIProps) => {
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
        "aria-current": selected ? ("page" as const) : undefined,
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
      sx={(theme) => ({
        height: 48,
        paddingX: theme.spacing(3),
        display: "flex",
        alignItems: "center",
        gap: theme.spacing(2),
      })}
    >
      <ListItemIcon sx={{ minWidth: "auto" }}>
        <Icon name={icon} />
      </ListItemIcon>
      {!collapsed && <ListItemText primary={label} />}
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
          <List disablePadding>
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
      items={items}
    >
      {children}
    </SidebarNavItemUI>
  );
};

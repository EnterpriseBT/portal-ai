import React, { useState } from "react";
import {
  Icon,
  IconName,
  ListItemButton,
  ListItemIcon,
  ListItemText,
  Collapse,
  List,
  ClickAwayListener,
} from "@mcp-ui/core/ui";
import { useLayout } from "../utils";

export interface SidebarNavChildItem {
  label: string;
  onClick?: () => void;
  selected?: boolean;
}

export interface SidebarNavItemUIProps {
  icon: IconName;
  label: string;
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

  const button = (
    <ListItemButton
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

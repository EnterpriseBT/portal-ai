import React, { useState } from "react";
import MuiMenu from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";

import { IconButton } from "./IconButton.js";
import { Icon, IconName } from "./Icon.js";
import type { ActionGate } from "./ActionGate.js";

export interface ActionMenuItem {
  /** Display label for the menu item. */
  label: string;
  /** Optional icon rendered before the label. Accepts any React node. */
  icon?: React.ReactNode;
  /** Called when the menu item is clicked. The menu closes automatically. */
  onClick: () => void;
  /**
   * How the item renders for this caller (#688): `hide` drops it, `disable`
   * shows it aria-disabled with its reason, `upsell` shows it with a lock and
   * calls `onUpgrade`. Omitted = allow. (There is no `disabled` flag: a
   * disabled item must say why.)
   */
  gate?: ActionGate;
  /** MUI color applied to the label text (e.g. "error" for destructive actions). */
  color?: "inherit" | "error" | "primary" | "secondary";
}

export interface ActionsMenuProps {
  /** Menu items to render in the dropdown. */
  items: ActionMenuItem[];
  /** Accessible label for the trigger button. Defaults to "More actions". */
  ariaLabel?: string;
}

/** Items the caller should see at all (#688: `hide` is dropped). */
export const visibleActionItems = <T extends { gate?: ActionGate }>(
  items: T[] | undefined
): T[] => (items ?? []).filter((item) => item.gate?.kind !== "hide");

export const ActionsMenu: React.FC<ActionsMenuProps> = ({
  items,
  ariaLabel = "More actions",
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);
  const visible = visibleActionItems(items);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

  // #688: a menu whose every item is hidden has no trigger.
  if (visible.length === 0) return null;

  return (
    <>
      <IconButton
        icon={IconName.MoreVert}
        aria-label={ariaLabel}
        aria-haspopup="true"
        aria-expanded={open}
        onClick={handleOpen}
        size="small"
      />
      <MuiMenu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        anchorOrigin={{ vertical: "bottom", horizontal: "right" }}
        transformOrigin={{ vertical: "top", horizontal: "right" }}
      >
        {visible.map((item) => {
          const gate = item.gate;
          const disabled = gate?.kind === "disable";
          const upsell = gate?.kind === "upsell" ? gate : null;
          const entry = (
            <MuiMenuItem
              key={item.label}
              // aria-disabled, not MUI's `disabled` (pointer-events: none
              // would block the tooltip that says why).
              aria-disabled={disabled ? "true" : undefined}
              sx={
                disabled ? { cursor: "not-allowed", opacity: 0.38 } : undefined
              }
              onClick={() => {
                if (disabled) return;
                handleClose();
                if (upsell) upsell.onUpgrade();
                else item.onClick();
              }}
            >
              {(item.icon || upsell) && (
                <ListItemIcon>
                  {upsell ? (
                    <Icon name={IconName.Lock} fontSize="small" />
                  ) : (
                    item.icon
                  )}
                </ListItemIcon>
              )}
              <ListItemText
                sx={item.color ? { color: `${item.color}.main` } : undefined}
              >
                {item.label}
              </ListItemText>
            </MuiMenuItem>
          );
          return gate?.kind === "disable" || gate?.kind === "upsell" ? (
            <Tooltip
              key={item.label}
              title={gate.reason}
              describeChild
              placement="left"
            >
              {entry}
            </Tooltip>
          ) : (
            entry
          );
        })}
      </MuiMenu>
    </>
  );
};

export default ActionsMenu;

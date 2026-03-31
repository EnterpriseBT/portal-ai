import React, { useState } from "react";
import MuiMenu from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";

import { IconButton } from "./IconButton.js";
import { IconName } from "./Icon.js";

export interface ActionMenuItem {
  /** Display label for the menu item. */
  label: string;
  /** Optional icon rendered before the label. Accepts any React node. */
  icon?: React.ReactNode;
  /** Called when the menu item is clicked. The menu closes automatically. */
  onClick: () => void;
  /** Whether the item is disabled. */
  disabled?: boolean;
  /** MUI color applied to the label text (e.g. "error" for destructive actions). */
  color?: "inherit" | "error" | "primary" | "secondary";
}

export interface ActionsMenuProps {
  /** Menu items to render in the dropdown. */
  items: ActionMenuItem[];
  /** Accessible label for the trigger button. Defaults to "More actions". */
  ariaLabel?: string;
}

export const ActionsMenu: React.FC<ActionsMenuProps> = ({
  items,
  ariaLabel = "More actions",
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const open = Boolean(anchorEl);

  const handleOpen = (event: React.MouseEvent<HTMLElement>) => {
    setAnchorEl(event.currentTarget);
  };

  const handleClose = () => {
    setAnchorEl(null);
  };

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
        {items.map((item) => (
          <MuiMenuItem
            key={item.label}
            disabled={item.disabled}
            onClick={() => {
              handleClose();
              item.onClick();
            }}
          >
            {item.icon && <ListItemIcon>{item.icon}</ListItemIcon>}
            <ListItemText
              sx={item.color ? { color: `${item.color}.main` } : undefined}
            >
              {item.label}
            </ListItemText>
          </MuiMenuItem>
        ))}
      </MuiMenu>
    </>
  );
};

export default ActionsMenu;

import React, { useId } from "react";
import MuiMenu from "@mui/material/Menu";
import type { MenuProps } from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import ListItemIcon from "@mui/material/ListItemIcon";
import ListItemText from "@mui/material/ListItemText";
import Tooltip from "@mui/material/Tooltip";

import { Icon, IconName } from "./Icon.js";
import type { ActionMenuItem } from "./ActionsMenu.js";

export interface GatedMenuProps {
  /** The element the menu opens from; the menu is open while it's set. */
  anchorEl: HTMLElement | null;
  open: boolean;
  onClose: () => void;
  /** The items, already without `hide` ones (`visibleActionItems`). */
  items: ActionMenuItem[];
  /** The id of the button that opens it, which names the menu. */
  labelledBy?: string;
  /** The menu's own id, for the trigger's `aria-controls`. */
  id?: string;
  anchorOrigin?: MenuProps["anchorOrigin"];
  transformOrigin?: MenuProps["transformOrigin"];
}

/**
 * A menu of gated items (#688), shared by `ActionsMenu` and `SplitButton`
 * (#1122). MUI's Menu owns the keys (arrows, typeahead, Escape) and returns
 * focus to the trigger on close. A `disable` or `upsell` item stays
 * focusable with its reason as its description and tooltip (#793).
 */
export const GatedMenu: React.FC<GatedMenuProps> = ({
  anchorEl,
  open,
  onClose,
  items,
  labelledBy,
  id,
  anchorOrigin = { vertical: "bottom", horizontal: "right" },
  transformOrigin = { vertical: "top", horizontal: "right" },
}) => {
  const reasonIdBase = useId();
  return (
    <MuiMenu
      anchorEl={anchorEl}
      open={open}
      onClose={onClose}
      anchorOrigin={anchorOrigin}
      transformOrigin={transformOrigin}
      // The ids go on the list, which is the element with role="menu"
      // (MUI would put `id` on the popover around it).
      slotProps={{
        list: {
          ...(id ? { id } : {}),
          ...(labelledBy ? { "aria-labelledby": labelledBy } : {}),
        },
      }}
    >
      {items.map((item, index) => {
        const gate = item.gate;
        const disabled = gate?.kind === "disable";
        const upsell = gate?.kind === "upsell" ? gate : null;
        const reason =
          disabled || upsell ? (gate as { reason: string }).reason : null;
        // #793: the reason is the item's description, not only its
        // tooltip. A hidden element inside the item: aria-describedby
        // reads it, and hidden text doesn't join the item's name.
        const reasonId = reason ? `${reasonIdBase}-${index}` : undefined;
        const entry = (
          <MuiMenuItem
            key={item.label}
            // aria-disabled, not MUI's `disabled` (pointer-events: none
            // would block the tooltip that says why). The theme gives it
            // its look (a11yComponents, #793).
            aria-disabled={disabled ? "true" : undefined}
            aria-describedby={reasonId}
            onClick={() => {
              if (disabled) return;
              onClose();
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
            {reason && (
              <span id={reasonId} hidden>
                {reason}
              </span>
            )}
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
  );
};

export default GatedMenu;

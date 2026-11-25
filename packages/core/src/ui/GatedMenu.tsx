import React, { useId } from "react";
import MuiMenu from "@mui/material/Menu";
import type { MenuProps } from "@mui/material/Menu";
import MuiMenuItem from "@mui/material/MenuItem";
import Divider from "@mui/material/Divider";
import ListSubheader from "@mui/material/ListSubheader";
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
  // #1122: each item's section heading id, found in one pass. A section is
  // a run of adjacent items; a name used again later starts a new run with
  // its own heading, so each item points at its own run's heading.
  const sectionIds: (string | undefined)[] = [];
  let runId: string | undefined;
  items.forEach((item, index) => {
    if (index === 0 || items[index - 1].section !== item.section) {
      runId = item.section ? `${reasonIdBase}-section-${index}` : undefined;
    }
    sectionIds.push(runId);
  });
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
          // #793: a gated item stays reachable from the keyboard, so its
          // reason can be read. MenuList skips aria-disabled items without
          // this.
          disabledItemsFocusable: true,
          ...(id ? { id } : {}),
          ...(labelledBy ? { "aria-labelledby": labelledBy } : {}),
        },
      }}
    >
      {items.flatMap((item, index) => {
        // #1122: a new section starts with a divider (but not at the top)
        // and its heading. Neither is focusable: MUI's MenuList skips them.
        // A menu may hold only items, groups and separators, and MenuList
        // walks sibling elements, so the heading isn't a group label: it's
        // visual (aria-hidden), and each item in the section is described
        // by it, so it's read as "Finance Close, Favorite stations".
        const sectionStart =
          index === 0 || items[index - 1].section !== item.section;
        const sectionId = sectionIds[index];
        const lead: React.ReactNode[] = [];
        if (sectionStart && index > 0) {
          lead.push(<Divider key={`divider-${index}`} />);
        }
        if (sectionStart && item.section) {
          lead.push(
            <ListSubheader
              key={`section-${index}`}
              id={sectionId}
              aria-hidden
              disableSticky
            >
              {item.section}
            </ListSubheader>
          );
        }
        // Labels aren't unique (two favorite stations named "Sales"), so an
        // item without an id is keyed by its place.
        const key = item.id ?? `${index}:${item.label}`;
        if (item.hint) {
          return [
            ...lead,
            <MuiMenuItem
              key={key}
              aria-disabled="true"
              aria-describedby={sectionId}
            >
              <ListItemText>{item.label}</ListItemText>
            </MuiMenuItem>,
          ];
        }
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
            key={key}
            // aria-disabled, not MUI's `disabled` (pointer-events: none
            // would block the tooltip that says why). The theme gives it
            // its look (a11yComponents, #793).
            aria-disabled={disabled ? "true" : undefined}
            aria-describedby={
              [sectionId, reasonId].filter(Boolean).join(" ") || undefined
            }
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
        return [
          ...lead,
          gate?.kind === "disable" || gate?.kind === "upsell" ? (
            <Tooltip
              key={key}
              title={gate.reason}
              describeChild
              placement="left"
            >
              {entry}
            </Tooltip>
          ) : (
            entry
          ),
        ];
      })}
    </MuiMenu>
  );
};

export default GatedMenu;

import React, { useState } from "react";

import { IconButton } from "./IconButton.js";
import { IconName } from "./Icon.js";
import type { ActionGate } from "./ActionGate.js";
import { GatedMenu } from "./GatedMenu.js";

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
  /**
   * The heading it's listed under (#1122). Adjacent items share a section;
   * a divider (and the heading, when set) starts each new one.
   */
  section?: string;
  /**
   * A line that teaches rather than acts ("Star a station to add it
   * here"): listed and focusable so it's read, but it does nothing.
   */
  hint?: boolean;
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
      <GatedMenu
        anchorEl={anchorEl}
        open={open}
        onClose={handleClose}
        items={visible}
      />
    </>
  );
};

export default ActionsMenu;

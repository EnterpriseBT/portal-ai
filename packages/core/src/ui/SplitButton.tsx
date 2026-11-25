import React, { useId, useState } from "react";
import MuiButtonGroup from "@mui/material/ButtonGroup";

import { ALLOW, pendingGate } from "./ActionGate.js";
import type { ActionGate } from "./ActionGate.js";
import { visibleActionItems } from "./ActionsMenu.js";
import type { ActionMenuItem } from "./ActionsMenu.js";
import { GatedButton } from "./GatedButton.js";
import { GatedMenu } from "./GatedMenu.js";
import { Icon, IconName } from "./Icon.js";

export interface SplitButtonProps {
  /** The main action's name: its text, or its `aria-label` as an icon. */
  label: string;
  onClick: () => void;
  /**
   * The main action's gate (#688). `hide` hides the whole control;
   * `disable` and `upsell` apply to the main action only, since each menu
   * item carries its own gate.
   */
  gate?: ActionGate;
  /** The main action's request is in flight: it reads `pendingLabel`. */
  pending?: boolean;
  pendingLabel?: string;
  /** The main action's icon: its start icon, or all of it as an icon. */
  icon?: IconName;
  /** The menu's items. With none visible, the control is a plain button. */
  menuItems: ActionMenuItem[];
  /** The menu button's name. Defaults to "More options for {label}". */
  menuLabel?: string;
  /**
   * The view decides (the view owns layout): `full` shows the label,
   * `icon` shows only the icon, named by `label`.
   */
  layout?: "full" | "icon";
  variant?: "contained" | "outlined";
  size?: "small" | "medium";
}

/**
 * A main action with a menu of related ones (#1122): a button and a menu
 * button side by side. The menu follows the menu-button pattern (the
 * button reports `aria-haspopup`, `aria-expanded` and `aria-controls`;
 * MUI's Menu owns the keys and returns focus on close).
 *
 * Both halves are `GatedButton`s, so a blocked one stays focusable and
 * reads its reason (#793). They sit in a ButtonGroup, which styles them
 * through context, so the gate's hidden reason doesn't break the group.
 */
export const SplitButton: React.FC<SplitButtonProps> = ({
  label,
  onClick,
  gate = ALLOW,
  pending = false,
  pendingLabel = "Saving…",
  icon = IconName.Add,
  menuItems,
  menuLabel,
  layout = "full",
  variant = "contained",
  size = "medium",
}) => {
  const [anchorEl, setAnchorEl] = useState<HTMLElement | null>(null);
  const menuId = useId();
  const menuButtonId = useId();
  const open = Boolean(anchorEl);
  const items = visibleActionItems(menuItems);

  if (gate.kind === "hide") return null;

  // Precedence permission → tier → state: a pending request only matters
  // when the caller may run the action at all.
  const mainGate =
    gate.kind === "allow" ? pendingGate(pending, pendingLabel) : gate;
  const iconOnly = layout === "icon";

  return (
    <>
      <MuiButtonGroup variant={variant} size={size}>
        <GatedButton
          gate={mainGate}
          onClick={onClick}
          aria-label={iconOnly ? label : undefined}
          // Icon-only, it shows its name on hover or focus too.
          tooltip={iconOnly ? label : undefined}
          startIcon={iconOnly ? undefined : <Icon name={icon} />}
        >
          {iconOnly ? <Icon name={icon} /> : label}
        </GatedButton>
        {items.length > 0 && (
          <GatedButton
            id={menuButtonId}
            aria-label={menuLabel ?? `More options for ${label}`}
            // Always an icon, so it shows its name too (not while its menu
            // is open, where the tooltip would cover the menu).
            tooltip={
              open ? undefined : (menuLabel ?? `More options for ${label}`)
            }
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={(event) => setAnchorEl(event.currentTarget)}
          >
            <Icon name={IconName.ArrowDropDown} />
          </GatedButton>
        )}
      </MuiButtonGroup>
      <GatedMenu
        id={menuId}
        labelledBy={menuButtonId}
        anchorEl={anchorEl}
        open={open}
        onClose={() => setAnchorEl(null)}
        items={items}
      />
    </>
  );
};

export default SplitButton;

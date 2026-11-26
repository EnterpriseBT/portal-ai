import React from "react";

import { Button, Icon, IconButton, IconName, Kbd } from "@portalai/core/ui";

export interface CommandPaletteTriggerUIProps {
  onOpen: () => void;
  /** Which shortcut to show: "⌘K" on a Mac, "Ctrl K" elsewhere. */
  platform: "mac" | "other";
  /**
   * #1076: the view decides. The full search box, or an icon at narrow
   * widths, named by the same text.
   */
  layout?: "full" | "icon";
}

/**
 * The header's way into the command palette (#1122), drawn as a search box
 * with its shortcut. Its name is its visible text; the keycap is decorative
 * and the shortcut is announced through `aria-keyshortcuts`.
 */
export const CommandPaletteTriggerUI: React.FC<
  CommandPaletteTriggerUIProps
> = ({ onOpen, platform, layout = "full" }) => {
  const mac = platform === "mac";
  if (layout === "icon") {
    return (
      <IconButton
        icon={IconName.Search}
        color="inherit"
        onClick={onOpen}
        aria-label="Search or run…"
        aria-haspopup="dialog"
        aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      />
    );
  }
  return (
    <Button
      variant="outlined"
      color="inherit"
      size="small"
      onClick={onOpen}
      aria-haspopup="dialog"
      aria-keyshortcuts={mac ? "Meta+K" : "Control+K"}
      startIcon={<Icon name={IconName.Search} />}
      endIcon={<Kbd aria-hidden>{mac ? "⌘K" : "Ctrl K"}</Kbd>}
    >
      Search or run…
    </Button>
  );
};

import React from "react";

import { Icon, IconName, Typography } from "@portalai/core/ui";

import { TagColorDotUI } from "./TagColorDot.component";
import {
  LAUNCHER_TYPE_ICON,
  launcherTypeNoun,
  type PaletteEntry,
} from "../utils/launcher-items.util";

export interface CommandPaletteOptionUIProps {
  entry: PaletteEntry;
}

/**
 * One command palette row's content (#1122), inside the option the
 * combobox renders. An object reads "{name} · {type}" with its tags' colour
 * dots; an action reads its label, and a gated one shows its reason, which
 * the combobox also reads as the option's description, so it's hidden here
 * from assistive tech to keep it out of the option's name.
 */
export const CommandPaletteOptionUI: React.FC<CommandPaletteOptionUIProps> = ({
  entry,
}) => {
  if (entry.kind === "item") {
    const coloured = (entry.tags ?? []).filter((tag) => tag.color);
    return (
      <>
        <Icon name={LAUNCHER_TYPE_ICON[entry.type]} fontSize="small" />
        <span>{entry.name}</span>
        <Typography component="span" variant="body2" color="text.secondary">
          · {launcherTypeNoun(entry.type)}
        </Typography>
        {coloured.map((tag) => (
          <TagColorDotUI key={tag.id} color={tag.color as string} />
        ))}
      </>
    );
  }
  const gate = entry.gate;
  const reason =
    gate?.kind === "disable" || gate?.kind === "upsell" ? gate.reason : null;
  return (
    <>
      <Icon
        name={
          gate?.kind === "upsell" ? IconName.Lock : (entry.icon ?? IconName.Add)
        }
        fontSize="small"
      />
      <span>{entry.label}</span>
      {reason && (
        <Typography
          component="span"
          variant="caption"
          color="text.secondary"
          aria-hidden
        >
          {reason}
        </Typography>
      )}
    </>
  );
};

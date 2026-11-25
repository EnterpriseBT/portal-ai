import { IconName } from "@portalai/core/ui";
import type { ActionGate, ComboboxOption } from "@portalai/core/ui";
import type { TagTargetType } from "@portalai/core/models";

import { TAG_TARGET_NOUNS } from "./tag-usage.util";

/**
 * Display types for the launcher's components (#1122): what the palette,
 * the New portal menu and the sidebar Favorites group render. They aren't
 * data contracts; the wiring tickets (#1075, #1076, #1077) map their data
 * onto them.
 */

/** The object types the launcher lists: every taggable type. */
export type LauncherItemType = TagTargetType;

/** An object the launcher links to. */
export interface LauncherItem {
  id: string;
  type: LauncherItemType;
  name: string;
  href: string;
  /** Its tags, drawn as colour dots. */
  tags?: { id: string; name: string; color: string | null }[];
}

/** Something the palette can do, such as "New portal". */
export interface PaletteAction {
  id: string;
  label: string;
  onSelect: () => void;
  /** Gated exactly like the action's own button (#688). */
  gate?: ActionGate;
  icon?: IconName;
}

export type PaletteEntry =
  | ({ kind: "item" } & LauncherItem)
  | ({ kind: "action" } & PaletteAction);

/** One heading's worth of palette rows: "Actions", "Favorites", "Views". */
export interface PaletteGroup {
  label: string;
  entries: PaletteEntry[];
}

/** A combobox option that carries its palette entry. */
export type PaletteOption = ComboboxOption & { entry: PaletteEntry };

/** Each type's icon, the same ones the sidebar uses for its pages. */
export const LAUNCHER_TYPE_ICON: Record<LauncherItemType, IconName> = {
  station: IconName.SatelliteAlt,
  pin: IconName.PushPin,
  curated_view: IconName.Layers,
  connector_instance: IconName.MemoryChip,
  entity: IconName.DataObject,
};

/** A type's singular noun: "station", "pinned result", "view". */
export const launcherTypeNoun = (type: LauncherItemType): string =>
  TAG_TARGET_NOUNS[type][0];

/**
 * The groups as combobox options, in order. An entry appearing in two
 * groups (a favorite that's also recent) gets an id per group, so each
 * row is distinct. Empty groups are dropped.
 */
export function paletteOptions(groups: PaletteGroup[]): PaletteOption[] {
  return groups.flatMap((group) =>
    group.entries.map((entry) => ({
      id: `${group.label}:${entry.kind}:${entry.id}`,
      label: entry.kind === "item" ? entry.name : entry.label,
      group: group.label,
      entry,
      ...(entry.kind === "item"
        ? { href: entry.href }
        : { onSelect: entry.onSelect, gate: entry.gate }),
    }))
  );
}

/** What the palette's live region says. */
export function paletteStatusText(count: number, loading: boolean): string {
  if (loading) return "Loading results…";
  if (count === 0) return "No results";
  return `${count} ${count === 1 ? "result" : "results"}`;
}

import { IconName } from "@portalai/core/ui";
import type { ActionGate, ComboboxOption } from "@portalai/core/ui";
import type { SearchResult, SearchResultType } from "@portalai/core/contracts";

import { TAG_TARGET_NOUNS } from "./tag-usage.util";

/**
 * Display types for the launcher's components (#1122): what the palette,
 * the Open Portal menu and the sidebar Favorites group render. They aren't
 * data contracts; the wiring tickets (#1075, #1076, #1077) map their data
 * onto them.
 */

/** The object types the launcher lists: every searchable type (#1076). */
export type LauncherItemType = SearchResultType;

/** An object the launcher links to. */
export interface LauncherItem {
  id: string;
  type: LauncherItemType;
  name: string;
  href: string;
  /** Its tags, drawn as colour dots. */
  tags?: { id: string; name: string; color: string | null }[];
}

/**
 * Something the palette can do, such as "Open Portal". An action runs
 * `onSelect`, or, when it goes to a page (a create's `?create=` link,
 * #1076), is a link to `href`. Exactly one of the two is set.
 */
export interface PaletteAction {
  id: string;
  label: string;
  onSelect?: () => void;
  href?: string;
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
  portal: IconName.Portal,
};

/** A type's singular noun: "station", "pinned result", "view". */
export const launcherTypeNoun = (type: LauncherItemType): string =>
  type === "portal" ? "portal" : TAG_TARGET_NOUNS[type][0];

/** Each type's results heading in the palette. */
export const RESULT_GROUP_LABEL: Record<LauncherItemType, string> = {
  station: "Stations",
  pin: "Pinned results",
  curated_view: "Views",
  connector_instance: "Connectors",
  entity: "Entities",
  portal: "Portals",
};

/** Each type's detail route. */
const DETAIL_ROUTE: Record<LauncherItemType, string> = {
  station: "/stations",
  pin: "/portal-results",
  curated_view: "/views",
  connector_instance: "/connectors",
  entity: "/entities",
  portal: "/portals",
};

/** A search result as a palette item linking to its detail page. */
export function toLauncherItem(result: SearchResult): LauncherItem {
  return {
    id: result.id,
    type: result.type,
    name: result.name,
    href: `${DETAIL_ROUTE[result.type]}/${encodeURIComponent(result.id)}`,
    tags: result.tags,
  };
}

/**
 * What the palette's text asks for (#1076): nothing yet (home), a name
 * search, or `#…`, a tag search (its text may be empty: `#` alone lists
 * tags).
 */
export type PaletteQuery =
  | { mode: "home" }
  | { mode: "search"; text: string }
  | { mode: "tag"; text: string };

export function parsePaletteQuery(raw: string): PaletteQuery {
  const trimmed = raw.trim();
  if (trimmed.startsWith("#")) {
    return { mode: "tag", text: trimmed.slice(1).trim() };
  }
  return trimmed ? { mode: "search", text: trimmed } : { mode: "home" };
}

/**
 * The groups as combobox options, in order. An entry appearing in two
 * groups (a favorite that's also recent) gets an id per group, so each
 * row is distinct. Actions the caller may not see (`hide`) are dropped
 * here, so the announced count matches the rows shown; empty groups drop
 * out with them.
 */
export function paletteOptions(groups: PaletteGroup[]): PaletteOption[] {
  return groups.flatMap((group) =>
    group.entries
      .filter(
        (entry) => !(entry.kind === "action" && entry.gate?.kind === "hide")
      )
      .map((entry) => ({
        id: `${group.label}:${entry.kind}:${entry.id}`,
        label: entry.kind === "item" ? entry.name : entry.label,
        group: group.label,
        entry,
        ...(entry.kind === "item"
          ? { href: entry.href }
          : { href: entry.href, onSelect: entry.onSelect, gate: entry.gate }),
      }))
  );
}

/** What the palette's live region says. */
export function paletteStatusText(count: number, loading: boolean): string {
  if (loading) return "Loading results…";
  if (count === 0) return "No results";
  return `${count} ${count === 1 ? "result" : "results"}`;
}

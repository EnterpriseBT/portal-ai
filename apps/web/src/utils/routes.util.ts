import { FAQCategory, GlossaryCategory } from "@portalai/core/content";

export enum ApplicationRoute {
  Dashboard = "/",
  Settings = "/settings",
  Login = "/login",
  Connectors = "/connectors",
  ConnectorInstance = "/connectors/$connectorInstanceId",
  Entities = "/entities",
  Entity = "/entities/$entityId",
  EntityRecord = "/entities/$entityId/records/$recordId",
  ColumnDefinitions = "/column-definitions",
  ColumnDefinition = "/column-definitions/$columnDefinitionId",
  EntityGroups = "/entity-groups",
  EntityGroup = "/entity-groups/$entityGroupId",
  Jobs = "/jobs",
  Tags = "/tags",
  Portal = "/portals/$portalId",
  Stations = "/stations",
  StationDetail = "/stations/$stationId",
  Toolpacks = "/toolpacks",
  PortalResults = "/portal-results",
  Help = "/help",
}

// ── Settings tabs (#284) ─────────────────────────────────────────────
//
// `/settings` renders three tabs with local state. Entitlement
// affordances elsewhere in the app need to land the user on the billing
// tab specifically — a link that names a plan limit and then opens the
// General tab is not an upgrade path — so the tab becomes addressable
// via `?tab=`.

export enum SettingsTab {
  Profile = "profile",
  Organization = "organization",
  Billing = "billing",
}

/** Tab order as rendered by `Settings.view.tsx`. */
export const SETTINGS_TAB_INDEX: Record<SettingsTab, number> = {
  [SettingsTab.Profile]: 0,
  [SettingsTab.Organization]: 1,
  [SettingsTab.Billing]: 2,
};

/**
 * Resolve a `?tab=` value from a location search string to a tab index.
 * Anything absent or unrecognized falls back to the first tab.
 */
export function settingsTabIndexFromSearch(search: string): number {
  const tab = new URLSearchParams(search).get("tab");
  if (!tab) return 0;
  return SETTINGS_TAB_INDEX[tab as SettingsTab] ?? 0;
}

// ── Help tabs (#365) ─────────────────────────────────────────────────
//
// Help is the surface the rest of the app links *to*, so unlike Settings
// above — read-once, tab clicks never rewrite the URL — its tab and category
// are a two-way contract: the URL is the state.
//
// `normalizeHelpSearch` is the single authority on what a valid Help address
// is. `routes/help.tsx` calls it from `validateSearch`, and `Help.view.tsx`
// calls it again defensively so the view stays renderable under a router that
// never ran validateSearch (the shared test router registers no file routes).
// Everything here fails open: an unknown tab, an unknown category, or a
// mismatched pair degrades to a working Help page, never an error.

export enum HelpTab {
  GettingStarted = "getting-started",
  Glossary = "glossary",
  Faq = "faq",
}

/** Tab order as rendered by `Help.view.tsx`. */
export const HELP_TAB_INDEX: Record<HelpTab, number> = {
  [HelpTab.GettingStarted]: 0,
  [HelpTab.Glossary]: 1,
  [HelpTab.Faq]: 2,
};

/** The two tabs that carry a category filter. Getting Started has none. */
export type HelpCategory = GlossaryCategory | FAQCategory;

export interface HelpSearch {
  tab?: HelpTab;
  category?: HelpCategory;
}

const HELP_TAB_VALUES = new Set<string>(Object.values(HelpTab));
const GLOSSARY_CATEGORY_VALUES = new Set<string>(
  Object.values(GlossaryCategory)
);
const FAQ_CATEGORY_VALUES = new Set<string>(Object.values(FAQCategory));

/**
 * Resolve a raw `category` against the enum that belongs to `tab`.
 *
 * The check is cross-field on purpose: `analytics` is a member of *both*
 * enums (which is what `/help?tab=faq&category=analytics` relies on), while
 * `data-modeling` is glossary-only and meaningless on the FAQ tab.
 */
function helpCategoryForTab(
  tab: HelpTab | undefined,
  raw: unknown
): HelpCategory | undefined {
  if (typeof raw !== "string") return undefined;
  if (tab === HelpTab.Glossary && GLOSSARY_CATEGORY_VALUES.has(raw)) {
    return raw as GlossaryCategory;
  }
  if (tab === HelpTab.Faq && FAQ_CATEGORY_VALUES.has(raw)) {
    return raw as FAQCategory;
  }
  return undefined;
}

/** Sanitize a raw search object into a valid Help address. Never throws. */
export function normalizeHelpSearch(
  search: Record<string, unknown>
): HelpSearch {
  const rawTab = search.tab;
  const tab =
    typeof rawTab === "string" && HELP_TAB_VALUES.has(rawTab)
      ? (rawTab as HelpTab)
      : undefined;

  return { tab, category: helpCategoryForTab(tab, search.category) };
}

/** Resolve a normalized search to the numeric index `useTabs` speaks. */
export function helpTabIndexFromSearch(search: HelpSearch): number {
  return search.tab ? HELP_TAB_INDEX[search.tab] : 0;
}

/** The tabs an entry anchor can address. */
export type HelpAnchorSurface = HelpTab.Glossary | HelpTab.Faq;

export interface HelpAnchor {
  surface: HelpAnchorSurface;
  slug: string;
}

const HELP_ANCHOR_PREFIX: Record<HelpAnchorSurface, string> = {
  [HelpTab.Glossary]: "glossary-entry-",
  [HelpTab.Faq]: "faq-entry-",
};

/**
 * Parse `#glossary-entry-<slug>` / `#faq-entry-<slug>`.
 *
 * Accepts the hash with or without its leading `#` — TanStack's
 * `location.hash` omits it, a hand-written href carries it. Anything else,
 * including a prefix with an empty slug, resolves to `undefined`; the caller
 * treats that as "no anchor" rather than an error.
 */
export function parseHelpAnchor(
  hash: string | undefined
): HelpAnchor | undefined {
  if (!hash) return undefined;
  const value = hash.startsWith("#") ? hash.slice(1) : hash;

  for (const surface of [HelpTab.Glossary, HelpTab.Faq] as const) {
    const prefix = HELP_ANCHOR_PREFIX[surface];
    if (value.startsWith(prefix)) {
      const slug = value.slice(prefix.length);
      return slug ? { surface, slug } : undefined;
    }
  }
  return undefined;
}

/** Build the fragment for an entry — the inverse of `parseHelpAnchor`. */
export function helpAnchorHash(anchor: HelpAnchor): string {
  return `${HELP_ANCHOR_PREFIX[anchor.surface]}${anchor.slug}`;
}

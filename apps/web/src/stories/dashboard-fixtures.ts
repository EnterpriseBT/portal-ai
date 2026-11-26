import type { StationOption } from "../components/StationPicker.component";
import type { FavoriteStationItem } from "../components/FavoriteStationCard.component";
import type { DashboardRecentPortal } from "../components/DashboardRecentPortals.component";
import type { TagCountChipUIProps } from "../components/TagCountChip.component";
import type { AttentionJob } from "../components/AttentionJobRow.component";
import type {
  TagResultGroupUIProps,
  TagResultItem,
} from "../components/TagResultGroup.component";

/** Example dashboard data for the #1123 workbench stories. */

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;
const ago = (ms: number) => Date.now() - ms;

export const STATIONS: StationOption[] = [
  { id: "s1", name: "Finance Close", favorite: true },
  { id: "s2", name: "Field Inspections", favorite: true },
  { id: "s3", name: "Customer Success", favorite: false },
  { id: "s4", name: "Supply Chain", favorite: false },
  { id: "s5", name: "Marketing Analytics", favorite: false },
];

export const FAVORITE_STATIONS: FavoriteStationItem[] = [
  {
    station: {
      id: "s1",
      name: "Finance Close",
      description: "GL accounts, journal entries and the close calendar.",
    },
    lastActivity: ago(2 * HOUR),
  },
  {
    station: {
      id: "s2",
      name: "Field Inspections",
      description: "Site visits, findings and county boundaries.",
    },
    lastActivity: ago(3 * DAY),
  },
  {
    station: { id: "s6", name: "Board Pack" },
    lastActivity: null,
  },
];

export const RECENT_PORTALS: DashboardRecentPortal[] = [
  {
    id: "p1",
    name: "Q3 variance by region",
    stationName: "Finance Close",
    created: ago(3 * DAY),
    lastOpened: ago(12 * MINUTE),
  },
  {
    id: "p2",
    name: "Open inspections near Austin",
    stationName: "Field Inspections",
    created: ago(1 * DAY),
    lastOpened: ago(5 * HOUR),
  },
  {
    id: "p3",
    name: "Churn drivers",
    stationName: "Customer Success",
    created: ago(2 * DAY),
    lastOpened: null,
  },
  {
    id: "p4",
    name: "Late shipments",
    stationName: "Supply Chain",
    created: ago(4 * DAY),
    lastOpened: ago(3 * DAY),
  },
  {
    id: "p5",
    name: "Campaign attribution",
    stationName: "Marketing Analytics",
    created: ago(6 * DAY),
    lastOpened: ago(5 * DAY),
  },
  {
    id: "p6",
    name: "Accrual review",
    stationName: "Finance Close",
    created: ago(9 * DAY),
    lastOpened: ago(8 * DAY),
  },
];

export const TAG_COUNTS: TagCountChipUIProps[] = [
  { tag: { id: "t1", name: "Finance", color: "#2e7d32" }, count: 14 },
  { tag: { id: "t2", name: "Field ops", color: "#1565c0" }, count: 9 },
  { tag: { id: "t3", name: "Quarterly", color: "#ad1457" }, count: 6 },
  { tag: { id: "t4", name: "Draft", color: null }, count: 2 },
];

export const ATTENTION_JOBS: AttentionJob[] = [
  {
    id: "j1",
    type: "connector_sync",
    status: "failed",
    where: "Salesforce",
    updated: ago(25 * MINUTE),
  },
  {
    id: "j2",
    type: "layout_plan_commit",
    status: "awaiting_confirmation",
    where: "Q3 budget.xlsx",
    updated: ago(2 * HOUR),
  },
  {
    id: "j3",
    type: "revalidation",
    status: "stalled",
    where: "Inspections",
    updated: ago(1 * DAY),
  },
];

const tagged = (prefix: string, names: string[]): TagResultItem[] =>
  names.map((name, i) => ({
    id: `${prefix}${i + 1}`,
    name,
    href: `/${prefix === "s" ? "stations" : "portal-results"}/${prefix}${i + 1}`,
  }));

export const TAG_GROUPS: TagResultGroupUIProps[] = [
  {
    title: "Stations",
    items: tagged("s", ["Finance Close", "Board Pack"]),
    total: 2,
    viewAllHref: "/stations",
  },
  {
    title: "Pinned results",
    items: tagged("r", ["Q3 variance by region", "Accrual review"]),
    total: 11,
    viewAllHref: "/portal-results",
  },
  { title: "Views", items: [], total: 0, viewAllHref: "/views" },
];

const items = (type: string, names: string[]): TagResultItem[] =>
  names.map((name, i) => ({
    id: `${type}-${i + 1}`,
    name,
    href: `/${type}/${type}-${i + 1}`,
  }));

const group = (
  title: string,
  path: string,
  names: string[],
  total = names.length
): TagResultGroupUIProps => ({
  title,
  items: items(path, names),
  total,
  viewAllHref: `/${path}`,
});

/** What carries each of `TAG_COUNTS`' tags, grouped by type; each tag's
 *  totals add up to its chip's count. */
export const TAG_PAGES: Record<string, TagResultGroupUIProps[]> = {
  t1: [
    group("Stations", "stations", ["Finance Close", "Board Pack"]),
    group(
      "Pinned results",
      "portal-results",
      ["Q3 variance by region", "Accrual review", "Board summary"],
      9
    ),
    group("Views", "views", [
      "GL accounts",
      "Journal entries",
      "Close calendar",
    ]),
    group("Connectors", "connectors", []),
  ],
  t2: [
    group("Stations", "stations", ["Field Inspections"]),
    group(
      "Pinned results",
      "portal-results",
      ["Open inspections by county", "Inspection sites"],
      4
    ),
    group("Views", "views", ["Open findings", "Site visits"]),
    group("Connectors", "connectors", ["Inspections CSV"]),
  ],
  t3: [
    group("Stations", "stations", []),
    group(
      "Pinned results",
      "portal-results",
      ["Q3 variance by region", "Accrual review", "Board summary"],
      6
    ),
    group("Views", "views", []),
    group("Connectors", "connectors", []),
  ],
  t4: [
    group("Stations", "stations", []),
    group("Pinned results", "portal-results", []),
    group("Views", "views", ["Draft budget", "Scratch view"]),
    group("Connectors", "connectors", []),
  ],
};

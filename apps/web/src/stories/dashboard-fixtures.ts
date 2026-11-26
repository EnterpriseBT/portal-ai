import type { StationOption } from "../components/StationPicker.component";
import type { FavoriteStationItem } from "../components/FavoriteStationCard.component";
import type { DashboardRecentPortal } from "../components/DashboardRecentPortals.component";
import type { TagCountChipUIProps } from "../components/TagCountChip.component";
import type { AttentionJob } from "../components/AttentionJobRow.component";
import type { TagMatch } from "../components/BrowseByTag.component";

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

const match = (
  type: TagMatch["type"],
  path: string,
  id: string,
  name: string
): TagMatch => ({ id, name, type, href: `/${path}/${id}` });

/** What carries each of `TAG_COUNTS`' tags; each list's length is its
 *  chip's count. */
export const TAG_MATCHES: Record<string, TagMatch[]> = {
  t1: [
    match("station", "stations", "s1", "Finance Close"),
    match("station", "stations", "s6", "Board Pack"),
    ...[
      "Q3 variance by region",
      "Accrual review",
      "Board summary",
      "Cash position",
      "AP aging",
      "AR aging",
      "Budget vs actual",
      "Headcount cost",
      "Close checklist",
    ].map((name, i) => match("pin", "portal-results", `r${i + 1}`, name)),
    match("view", "views", "v1", "GL accounts"),
    match("view", "views", "v2", "Journal entries"),
    match("connector", "connectors", "c1", "NetSuite export"),
  ],
  t2: [
    match("station", "stations", "s2", "Field Inspections"),
    match("pin", "portal-results", "r10", "Open inspections by county"),
    match("pin", "portal-results", "r11", "Inspection sites"),
    match("view", "views", "v3", "Open findings"),
    match("view", "views", "v4", "Site visits"),
    match("connector", "connectors", "c2", "Inspections CSV"),
    match("connector", "connectors", "c3", "County GIS"),
    match("entity", "entities", "e1", "Findings"),
    match("entity", "entities", "e2", "Sites"),
  ],
  t3: [
    match("pin", "portal-results", "r1", "Q3 variance by region"),
    match("pin", "portal-results", "r2", "Accrual review"),
    match("pin", "portal-results", "r3", "Board summary"),
    match("view", "views", "v5", "Quarterly revenue"),
    match("view", "views", "v6", "Quarterly headcount"),
    match("station", "stations", "s6", "Board Pack"),
  ],
  t4: [
    match("view", "views", "v7", "Draft budget"),
    match("view", "views", "v8", "Scratch view"),
  ],
};

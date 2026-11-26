import type { StationOption } from "../components/StationPicker.component";
import type { FavoriteStationItem } from "../components/FavoriteStationCard.component";
import type { DashboardRecentPortal } from "../components/DashboardRecentPortals.component";

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

export const EXAMPLE_PROMPTS = [
  "Which regions missed their Q3 targets?",
  "Map open inspections by county",
  "Summarize churned accounts this month",
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

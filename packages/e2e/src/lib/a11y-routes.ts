/**
 * Every page the accessibility walk visits (#792), and which epic child a
 * finding on it goes to when nothing more specific places it. The route-file
 * coverage test keeps this in step with apps/web/src/routes and
 * apps/site/src/pages: a new page fails it until it's listed here.
 *
 * A browser finding carries no component path, so a route's owner is where
 * triage starts, not a verdict. Shell rules (landmarks, bypass, title) go to
 * #797 whatever the route.
 */
import type { E2eIdentity } from "./target.js";

export type A11yOwner = 793 | 794 | 795 | 796 | 797 | 798;

/**
 * One hop of a drill: visit a page and take the id of the first item its own
 * list request returns (the first whose JSON matches `pick`, when given).
 * Reading the response, not the markup, works whether the list renders as
 * a table, cards or links.
 */
export interface A11yDrillStep {
  /** The page to visit, given the ids taken by earlier steps. */
  visit: string | ((ids: readonly string[]) => string);
  /** Path pattern of the list request to read (apiPathMatcher). */
  api: string;
  pick?: RegExp;
}

export interface A11yRoute {
  /** Stable id: it appears in every finding's location. */
  id: string;
  /** The apps/web/src/routes file (without .tsx) this entry covers. */
  route: string;
  /** A literal path, for routes without params. */
  path?: string;
  /** For routes with params: the hops that collect ids, and the page path
   *  built from them (one id per step). */
  drill?: {
    steps: readonly A11yDrillStep[];
    path: (ids: readonly string[]) => string;
  };
  owner: A11yOwner;
  /** Walked from a fresh, signed-out context (role null). */
  signedOut?: true;
  /** Defaults to all three. */
  roles?: readonly E2eIdentity[];
  /** State → path pattern of the API request to intercept (apiPathMatcher). */
  states: Partial<Record<"empty" | "error" | "loading" | "locked", string>>;
}

/** The common drill: from an index page, into its first item. */
const into = (index: string, api: string) => ({
  steps: [{ visit: index, api: `/api/${api}` }],
  path: ([id]: readonly string[]) => `${index}/${id}`,
});

/** List page states: one glob for the list request. */
const list = (api: string) => ({
  empty: `/api/${api}`,
  error: `/api/${api}`,
  loading: `/api/${api}`,
});
/** Detail page states: the object's own request. */
const one = (api: string) => ({
  error: `/api/${api}/*`,
  loading: `/api/${api}/*`,
});
const running = (api: string) => `/api/${api}/*/running-jobs`;

/** The views that render ConnectorInstanceLockAlertUI. */
export const LOCK_ALERT_ROUTES = [
  "connectors.$connectorInstanceId.index",
  "entities.$entityId.index",
  "entities.$entityId.records.$recordId",
  "column-definitions.$columnDefinitionId",
] as const;

export const A11Y_ROUTES: readonly A11yRoute[] = [
  { id: "dashboard", route: "index", path: "/", owner: 797, states: {} },
  { id: "help", route: "help.index", path: "/help", owner: 797, states: {} },
  {
    id: "settings",
    route: "settings",
    path: "/settings",
    owner: 793,
    states: one("organization"),
  },

  {
    id: "connectors",
    route: "connectors.index",
    path: "/connectors",
    owner: 794,
    states: list("connector-instances"),
  },
  {
    id: "connector-detail",
    route: "connectors.$connectorInstanceId.index",
    drill: into("/connectors", "connector-instances"),
    owner: 794,
    states: {
      ...one("connector-instances"),
      locked: running("connector-instances"),
    },
  },
  {
    id: "layout-plan-edit",
    route: "connectors.$connectorInstanceId.layout-plan.edit",
    drill: {
      // A spreadsheet-backed instance: only those have a layout plan.
      steps: [
        {
          visit: "/connectors",
          api: "/api/connector-instances",
          pick: /file.?upload|xlsx|csv|sheets|excel/i,
        },
      ],
      path: ([id]) => `/connectors/${id}/layout-plan/edit`,
    },
    owner: 795,
    states: {},
  },

  {
    id: "entities",
    route: "entities.index",
    path: "/entities",
    owner: 794,
    states: list("connector-entities"),
  },
  {
    id: "entity-detail",
    route: "entities.$entityId.index",
    drill: into("/entities", "connector-entities"),
    owner: 794,
    states: {
      ...one("connector-entities"),
      locked: running("connector-entities"),
    },
  },
  {
    id: "record-detail",
    route: "entities.$entityId.records.$recordId",
    drill: {
      steps: [
        { visit: "/entities", api: "/api/connector-entities" },
        {
          visit: ([entity]) => `/entities/${entity}`,
          api: "/api/connector-entities/*/records",
        },
      ],
      path: ([entity, record]) => `/entities/${entity}/records/${record}`,
    },
    owner: 794,
    states: {
      ...one("connector-entities/*/records"),
      locked: running("connector-entities"),
    },
  },
  {
    id: "column-definitions",
    route: "column-definitions.index",
    path: "/column-definitions",
    owner: 794,
    states: list("column-definitions"),
  },
  {
    id: "column-definition-detail",
    route: "column-definitions.$columnDefinitionId",
    drill: into("/column-definitions", "column-definitions"),
    owner: 794,
    states: {
      ...one("column-definitions"),
      locked: running("column-definitions"),
    },
  },
  {
    id: "entity-groups",
    route: "entity-groups.index",
    path: "/entity-groups",
    owner: 794,
    states: list("entity-groups"),
  },
  {
    id: "entity-group-detail",
    route: "entity-groups.$entityGroupId",
    drill: into("/entity-groups", "entity-groups"),
    owner: 794,
    states: one("entity-groups"),
  },
  {
    id: "tags",
    route: "tags.index",
    path: "/tags",
    owner: 794,
    states: list("entity-tags"),
  },

  {
    id: "stations",
    route: "stations.index",
    path: "/stations",
    owner: 794,
    states: list("stations"),
  },
  {
    id: "station-detail",
    route: "stations.$stationId",
    drill: into("/stations", "stations"),
    owner: 794,
    states: one("stations"),
  },
  {
    id: "portal",
    route: "portals.$portalId",
    drill: {
      steps: [
        { visit: "/stations", api: "/api/stations" },
        { visit: ([station]) => `/stations/${station}`, api: "/api/portals" },
      ],
      path: ([, portal]) => `/portals/${portal}`,
    },
    owner: 796,
    states: one("portals"),
  },
  {
    id: "portal-results",
    route: "portal-results.index",
    path: "/portal-results",
    owner: 794,
    states: list("portal-results"),
  },
  {
    id: "portal-result-detail",
    route: "portal-results.$portalResultId",
    drill: into("/portal-results", "portal-results"),
    owner: 796,
    states: one("portal-results"),
  },
  {
    id: "views",
    route: "views.index",
    path: "/views",
    owner: 794,
    states: list("curated-views"),
  },
  {
    id: "view-detail",
    route: "views.$viewId",
    drill: into("/views", "curated-views"),
    owner: 794,
    states: one("curated-views"),
  },
  {
    id: "toolpacks",
    route: "toolpacks.index",
    path: "/toolpacks",
    owner: 794,
    states: list("toolpacks"),
  },
  {
    id: "jobs",
    route: "jobs.index",
    path: "/jobs",
    owner: 794,
    states: list("jobs"),
  },
  {
    id: "job-detail",
    route: "jobs.$jobId",
    drill: into("/jobs", "jobs"),
    owner: 794,
    states: one("jobs"),
  },

  {
    id: "login",
    route: "login",
    path: "/login",
    owner: 793,
    signedOut: true,
    states: {},
  },
  {
    id: "not-invited",
    route: "not-invited",
    path: "/not-invited",
    owner: 793,
    signedOut: true,
    states: {},
  },
  {
    id: "invitation-accept",
    route: "invitations.accept",
    path: "/invitations/accept",
    owner: 793,
    signedOut: true,
    states: {},
  },
];

/** The built marketing site's pages (`astro preview`, :3002). */
export const SITE_PAGES: readonly string[] = [
  "/",
  "/features/",
  "/pricing/",
  "/contact/",
  "/security/",
  "/privacy/",
  "/terms/",
  "/404.html",
  "/use-cases/",
  "/use-cases/operations/",
  "/use-cases/founders/",
  "/use-cases/analysts/",
];

/** Route files that render a page: not `__root`, and not a layout that
 *  another route file nests under. */
export function leafRouteFiles(names: readonly string[]): string[] {
  return names.filter(
    (n) => n !== "__root" && !names.some((other) => other.startsWith(`${n}.`))
  );
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** The id of the first item in a list response's payload (the payload
 *  itself, or its first array), among those whose JSON matches `pick`.
 *  Null when there's nothing to drill into. */
export function firstId(body: unknown, pick?: RegExp): string | null {
  if (!isRecord(body)) return null;
  const payload = body.payload;
  const items = Array.isArray(payload)
    ? payload
    : isRecord(payload)
      ? Object.values(payload).find(Array.isArray)
      : undefined;
  for (const item of items ?? []) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    if (!pick || pick.test(JSON.stringify(item))) return item.id;
  }
  return null;
}

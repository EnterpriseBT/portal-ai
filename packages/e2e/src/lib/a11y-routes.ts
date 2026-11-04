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

/** One hop of a drill: on the current page, follow the first link (or
 *  click the first table row) that lands on a URL matching `url`, among
 *  those whose text matches `text` when given. */
export interface A11yDrillStep {
  url: RegExp;
  text?: RegExp;
}

export interface A11yRoute {
  /** Stable id: it appears in every finding's location. */
  id: string;
  /** The apps/web/src/routes file (without .tsx) this entry covers. */
  route: string;
  /** A literal path, for routes without params. */
  path?: string;
  /** For routes with params: an index path, then the hops to the page. */
  drill?: { from: string; steps: A11yDrillStep[] };
  owner: A11yOwner;
  /** Walked from a fresh, signed-out context (role null). */
  signedOut?: true;
  /** Defaults to all three. */
  roles?: readonly E2eIdentity[];
  /** State → Playwright URL glob of the request to intercept. */
  states: Partial<Record<"empty" | "error" | "loading" | "locked", string>>;
}

const UUID = "[0-9a-f-]{36}";
const detail = (segment: string) => new RegExp(`/${segment}/${UUID}/?$`);

/** List page states: one glob for the list request. */
const list = (api: string) => ({
  empty: `**/api/${api}*`,
  error: `**/api/${api}*`,
  loading: `**/api/${api}*`,
});
/** Detail page states: the object's own request. */
const one = (api: string) => ({
  error: `**/api/${api}/*`,
  loading: `**/api/${api}/*`,
});
const running = (api: string) => `**/api/${api}/*/running-jobs*`;

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
    drill: { from: "/connectors", steps: [{ url: detail("connectors") }] },
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
      from: "/connectors",
      steps: [
        {
          url: detail("connectors"),
          text: /csv|xlsx|spreadsheet|upload|excel|sheets/i,
        },
        { url: /\/layout-plan\/edit\/?$/ },
      ],
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
    drill: { from: "/entities", steps: [{ url: detail("entities") }] },
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
      from: "/entities",
      steps: [{ url: detail("entities") }, { url: /\/records\/[^/]+\/?$/ }],
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
    drill: {
      from: "/column-definitions",
      steps: [{ url: detail("column-definitions") }],
    },
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
    drill: {
      from: "/entity-groups",
      steps: [{ url: detail("entity-groups") }],
    },
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
    drill: { from: "/stations", steps: [{ url: detail("stations") }] },
    owner: 794,
    states: one("stations"),
  },
  {
    id: "portal",
    route: "portals.$portalId",
    drill: {
      from: "/stations",
      steps: [{ url: detail("stations") }, { url: detail("portals") }],
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
    drill: {
      from: "/portal-results",
      steps: [{ url: detail("portal-results") }],
    },
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
    drill: { from: "/views", steps: [{ url: detail("views") }] },
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
    drill: { from: "/jobs", steps: [{ url: detail("jobs") }] },
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

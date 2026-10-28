/**
 * Enumerates the `(method, path)` pairs the Express app actually registers, in
 * OpenAPI path-template form (`/api/portals/{id}`).
 *
 * Exists so the OpenAPI completeness guard can compare the document against the
 * real routing table instead of counting `@openapi` blocks per file (#443), and
 * so the route-authorization guard (#685, #692) can require every route to be
 * classified.
 *
 * ── Recorded at registration (#897) ────────────────────────────────────────
 * Express 4 kept mount paths only inside private matcher regexps, and Express
 * 5's router drops even those, so reading the router's internals breaks with
 * each major. Instead this module wraps the Router's public `route()` and
 * `use()` and records what each router registers, then walks those records from
 * the app's root router. It works the same on Express 4 and 5.
 *
 * The one requirement: this module must load BEFORE the app is built, so
 * import it ahead of `app.js`. An app built earlier records nothing, and both
 * callers assert a floor on the returned count, so that fails loudly rather
 * than letting a guard pass vacuously.
 */

import express from "express";

/** HTTP methods worth comparing against the document. */
const DOCUMENTED_METHODS = ["get", "post", "put", "patch", "delete"] as const;

type RecordedRoute = {
  path: string;
  route: { methods: Record<string, boolean> };
};
type RecordedMount = { path: string; handler: unknown };
type RouterRecord = { routes: RecordedRoute[]; mounts: RecordedMount[] };

const records = new WeakMap<object, RouterRecord>();
const RECORDER = Symbol.for("portalai.routeRecorder");

const recordFor = (router: object): RouterRecord => {
  let record = records.get(router);
  if (!record) {
    record = { routes: [], mounts: [] };
    records.set(router, record);
  }
  return record;
};

type RouterMethods = {
  route: (this: object, path: unknown) => { methods: Record<string, boolean> };
  use: (this: object, ...args: unknown[]) => unknown;
  [RECORDER]?: true;
};

/**
 * Wraps the Router's `route()` and `use()` to record registrations. Express 5's
 * methods live on `Router.prototype`; Express 4's on the `Router` function
 * itself. Installing twice is a no-op.
 */
export function installRouteRecorder(): void {
  const Router = express.Router as unknown as RouterMethods & {
    prototype?: RouterMethods;
  };
  const target: RouterMethods =
    typeof Router.prototype?.route === "function" ? Router.prototype : Router;
  if (target[RECORDER]) return;

  const route = target.route;
  target.route = function (this: object, path: unknown) {
    const created = route.call(this, path);
    for (const p of [path].flat()) {
      if (typeof p === "string")
        recordFor(this).routes.push({ path: p, route: created });
    }
    return created;
  };

  const use = target.use;
  target.use = function (this: object, ...args: unknown[]) {
    const first = args[0];
    const hasPath = typeof first === "string" || Array.isArray(first);
    const paths = hasPath ? [first].flat() : ["/"];
    const handlers = (hasPath ? args.slice(1) : args).flat(Infinity);
    for (const p of paths) {
      if (typeof p !== "string") continue;
      for (const handler of handlers) {
        recordFor(this).mounts.push({ path: p, handler });
      }
    }
    return use.apply(this, args);
  };

  target[RECORDER] = true;
}

installRouteRecorder();

const join = (prefix: string, path: string): string =>
  path === "/" ? prefix : prefix + path;

const walk = (router: object, prefix: string, out: Set<string>): void => {
  const record = records.get(router);
  if (!record) return;
  for (const { path, route } of record.routes) {
    const template =
      join(prefix, path).replace(/:([A-Za-z0-9_]+)/g, "{$1}") || "/";
    const normalized = template.replace(/\/$/, "") || "/";
    for (const method of Object.keys(route.methods)) {
      if ((DOCUMENTED_METHODS as readonly string[]).includes(method)) {
        out.add(`${method.toUpperCase()} ${normalized}`);
      }
    }
  }
  for (const { path, handler } of record.mounts) {
    if (handler && typeof handler === "function" && records.has(handler)) {
      walk(handler, join(prefix, path), out);
    }
  }
};

/**
 * Every route the app registers, as `"<METHOD> <path-template>"`.
 *
 * @param app the Express application (imported, not listening)
 */
export const registeredRoutes = (app: unknown): Set<string> => {
  const routes = new Set<string>();
  if (!app || typeof app !== "function") return routes;
  // Express 5 exposes the root router as `app.router`; Express 4 as `_router`.
  const root =
    (app as { _router?: object })._router ??
    (app as { router?: object }).router;
  if (root) walk(root, "", routes);
  return routes;
};

// ── Express 4 internals reader ─────────────────────────────────────────────
// Kept only for the recorder's parity test while the API is on Express 4;
// deleted with the Express 5 upgrade (#897 slice 5).

type RouteLayer = {
  regexp: RegExp & { fast_slash?: boolean };
  keys?: Array<{ name: string }>;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
};

/**
 * A single path param inside a mount regexp. Written to match both `[^/]` (what
 * Express 4.21 emits) and `[^\/]`, so a future escaping change degrades to a
 * visible failure rather than a silent mis-parse.
 */
const PARAM_GROUP = /\(\?:\\\/\(\[\^\\?\/\]\+\?\)\)/g;

/** Recover a mount prefix (`/api/connector-entities/{connectorEntityId}`). */
const mountPrefix = (layer: RouteLayer): string => {
  if (layer.regexp.fast_slash) return "";
  let paramIndex = 0;
  return layer.regexp.source
    .replace(/^\^/, "")
    .replace(/\\\/\?\(\?=\\\/\|\$\)$/, "")
    .replace(/\$$/, "")
    .replace(
      PARAM_GROUP,
      () => `/{${layer.keys?.[paramIndex++]?.name ?? "param"}}`
    )
    .replace(/\\\//g, "/");
};

const collect = (
  stack: RouteLayer[],
  prefix: string,
  out: Set<string>
): void => {
  for (const layer of stack) {
    if (layer.route) {
      const path =
        (prefix + layer.route.path).replace(/:([A-Za-z0-9_]+)/g, "{$1}") || "/";
      const normalized = path.replace(/\/$/, "") || "/";
      for (const method of Object.keys(layer.route.methods)) {
        if ((DOCUMENTED_METHODS as readonly string[]).includes(method)) {
          out.add(`${method.toUpperCase()} ${normalized}`);
        }
      }
    } else if (layer.handle?.stack) {
      collect(layer.handle.stack, prefix + mountPrefix(layer), out);
    }
  }
};

/** The Express 4 internals reader's view of the app, for the parity test. */
export const registeredRoutesFromInternals = (app: unknown): Set<string> => {
  const stack = (app as { _router?: { stack?: RouteLayer[] } })._router?.stack;
  const routes = new Set<string>();
  if (stack) collect(stack, "", routes);
  return routes;
};

/** Every operation the OpenAPI document declares, in the same form. */
export const documentedOperations = (spec: unknown): Set<string> => {
  const paths =
    (spec as { paths?: Record<string, Record<string, unknown>> }).paths ?? {};
  const operations = new Set<string>();
  for (const [path, item] of Object.entries(paths)) {
    for (const method of Object.keys(item)) {
      if ((DOCUMENTED_METHODS as readonly string[]).includes(method)) {
        operations.add(`${method.toUpperCase()} ${path}`);
      }
    }
  }
  return operations;
};

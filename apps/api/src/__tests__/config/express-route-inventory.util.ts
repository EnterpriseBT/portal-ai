/**
 * Enumerates the `(method, path)` pairs the Express app actually registers, in
 * OpenAPI path-template form (`/api/portals/{id}`).
 *
 * Exists so the OpenAPI completeness guard can compare the document against the
 * real routing table instead of counting `@openapi` blocks per file (#443). The
 * count could only catch an omitted block; it could not catch a block that
 * declares a path the app does not serve, and it could not catch a block whose
 * body is malformed. Comparing sets catches the first two.
 *
 * ── Express 4 coupling ──────────────────────────────────────────────────────
 * This reads router internals, which are private API:
 *
 *   - the stack lives at `app._router.stack` (Express 5 renames it `app.router`)
 *   - a mount's path is recoverable only from `layer.regexp.source`, since
 *     `layer.path` is populated during dispatch, not registration
 *   - param groups in that source are `(?:\/([^/]+?))` — the character class is
 *     `[^/]` with an UNESCAPED slash. A hand-written `[^\/]` matches nothing and
 *     silently yields un-substituted paths, so PARAM_GROUP tolerates both forms.
 *
 * Both callers assert a floor on the returned count. That is deliberate: if an
 * Express upgrade changes any of the above, this returns few or no routes, and a
 * guard built on it would otherwise pass vacuously — reporting success at the
 * exact moment it stopped working.
 */

type RouteLayer = {
  regexp: RegExp & { fast_slash?: boolean };
  keys?: Array<{ name: string }>;
  route?: { path: string; methods: Record<string, boolean> };
  handle?: { stack?: RouteLayer[] };
};

/** HTTP methods worth comparing against the document. */
const DOCUMENTED_METHODS = ["get", "post", "put", "patch", "delete"] as const;

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

/**
 * Every route the app registers, as `"<METHOD> <path-template>"`.
 *
 * @param app the Express application (imported, not listening)
 */
export const registeredRoutes = (app: unknown): Set<string> => {
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

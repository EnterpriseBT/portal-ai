/**
 * `ApplicationRoute` names real routes (#896).
 *
 * Route files used to pass the enum to `createFileRoute`, which tied each
 * value to its route id at compile time. The router generator now requires a
 * string literal there, so nothing else holds the two together: a renamed
 * route would compile while every `navigate`/`Link` built from the stale enum
 * value 404s at runtime.
 *
 * The compile-time half fails `type-check`; the runtime half reads the
 * generated tree, so it also fails when `routeTree.gen.ts` went stale.
 */

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

import { ApplicationRoute } from "../utils/routes.util";

import type { FileRoutesByFullPath } from "../routeTree.gen";

// Errors in type-check when an enum value isn't a generated route path.
const everyValueIsARoute: `${ApplicationRoute}` extends keyof FileRoutesByFullPath
  ? true
  : false = true;

const here = dirname(fileURLToPath(import.meta.url));
const routeTree = readFileSync(join(here, "..", "routeTree.gen.ts"), "utf8");

const fullPaths = (): Set<string> => {
  const block = routeTree.match(
    /export interface FileRoutesByFullPath \{([\s\S]*?)\n\}/
  );
  if (!block) throw new Error("FileRoutesByFullPath not found in routeTree");
  return new Set(
    [...block[1].matchAll(/^\s*'([^']+)':/gm)].map((match) => match[1])
  );
};

describe("ApplicationRoute", () => {
  it("is checked against the generated route paths at compile time", () => {
    expect(everyValueIsARoute).toBe(true);
  });

  it.each(Object.entries(ApplicationRoute))(
    "%s (%s) is a route in the generated tree",
    (_name, path) => {
      expect(fullPaths()).toContain(path);
    }
  );
});

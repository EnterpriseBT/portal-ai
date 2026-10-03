import { describe, it, expect } from "@jest/globals";

import { app } from "../../app.js";
import { registeredRoutes } from "./express-route-inventory.util.js";
import { ROUTE_AUTHORIZATION } from "./route-authorization.map.js";

/**
 * #685: the guard that keeps every mutation and SSE route authorized
 * server-side. #685 found routes that checked only org scope, or nothing
 * (and two that wrote to an org named in the request body), because nothing
 * forced a decision when a route was added. This test forces one:
 * every such route must be classified in ROUTE_AUTHORIZATION.
 */

const MUTATION = /^(POST|PATCH|PUT|DELETE) /;
const SSE = /^GET \/api\/sse\//;

/** The routes the guard covers: every mutation, plus every SSE stream. */
export function guardedRoutes(routes: Set<string>): string[] {
  return [...routes].filter((r) => MUTATION.test(r) || SSE.test(r)).sort();
}

describe("route authorization guard (#685)", () => {
  const registered = registeredRoutes(app);
  const guarded = guardedRoutes(registered);

  it("finds the routing table (the guard can't pass vacuously)", () => {
    expect(guarded.length).toBeGreaterThan(100);
  });

  it("classifies every mutation and SSE route", () => {
    const unclassified = guarded.filter((r) => !(r in ROUTE_AUTHORIZATION));
    expect(unclassified).toEqual([]);
  });

  it("has no stale entries", () => {
    const stale = Object.keys(ROUTE_AUTHORIZATION)
      .filter((r) => !registered.has(r))
      .sort();
    expect(stale).toEqual([]);
  });

  it("gives every exemption a reason and every authorized entry its check", () => {
    const vague = Object.entries(ROUTE_AUTHORIZATION)
      .filter(([, a]) =>
        a.kind === "exempt" ? !a.reason.trim() : !a.by.trim()
      )
      .map(([r]) => r);
    expect(vague).toEqual([]);
  });

  it("bites: an unclassified route is reported", () => {
    const withExtra = new Set([...registered, "POST /api/__unguarded_probe"]);
    const unclassified = guardedRoutes(withExtra).filter(
      (r) => !(r in ROUTE_AUTHORIZATION)
    );
    expect(unclassified).toContain("POST /api/__unguarded_probe");
  });
});

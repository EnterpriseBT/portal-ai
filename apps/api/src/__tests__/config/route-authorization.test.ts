import { describe, it, expect } from "@jest/globals";

import { app } from "../../app.js";
import { registeredRoutes } from "./express-route-inventory.util.js";
import { ROUTE_AUTHORIZATION } from "./route-authorization.map.js";

/**
 * #685: the guard that keeps every route authorized server-side. #685 found
 * mutation routes that checked only org scope, or nothing (and two that wrote
 * to an org named in the request body), because nothing forced a decision
 * when a route was added. #692 then found reads that did the same: the
 * field-mapping GETs returned any org's row by id. So the guard covers every
 * registered route, reads included: each must be classified in
 * ROUTE_AUTHORIZATION.
 */

/** The routes the guard covers: every registered route (#692 added reads). */
export function guardedRoutes(routes: Set<string>): string[] {
  return [...routes].sort();
}

describe("route authorization guard (#685, #692)", () => {
  const registered = registeredRoutes(app);
  const guarded = guardedRoutes(registered);

  it("finds the routing table (the guard can't pass vacuously)", () => {
    expect(guarded.length).toBeGreaterThan(180);
    expect(guarded.filter((r) => r.startsWith("GET ")).length).toBeGreaterThan(
      80
    );
  });

  it("classifies every route, reads included", () => {
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

  it("bites: an unclassified route is reported, a read as much as a write", () => {
    const withExtra = new Set([
      ...registered,
      "POST /api/__unguarded_probe",
      "GET /api/__unguarded_read_probe/{id}",
    ]);
    const unclassified = guardedRoutes(withExtra).filter(
      (r) => !(r in ROUTE_AUTHORIZATION)
    );
    expect(unclassified).toEqual(
      expect.arrayContaining([
        "POST /api/__unguarded_probe",
        "GET /api/__unguarded_read_probe/{id}",
      ])
    );
  });
});

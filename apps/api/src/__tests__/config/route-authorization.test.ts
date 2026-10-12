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

  // #769: every write path says what a running job would make read-only, so
  // a new route can't skip the job lock by omission.
  const mutating = (route: string) => !route.startsWith("GET ");

  it("classifies every mutating route's job lock (#769)", () => {
    const missing = Object.entries(ROUTE_AUTHORIZATION)
      .filter(([r, a]) => mutating(r) && !a.locks)
      .map(([r]) => r);
    expect(missing).toEqual([]);
  });

  it("gives job locks only to mutating routes (#769)", () => {
    const onReads = Object.entries(ROUTE_AUTHORIZATION)
      .filter(([r, a]) => !mutating(r) && a.locks)
      .map(([r]) => r);
    expect(onReads).toEqual([]);
  });

  it("records a real reason for every route that locks nothing (#769)", () => {
    const vague = Object.entries(ROUTE_AUTHORIZATION)
      .filter(
        ([, a]) =>
          a.locks && "none" in a.locks && a.locks.none.trim().length < 10
      )
      .map(([r]) => r);
    expect(vague).toEqual([]);
  });

  it("bites: a mutating route without a job-lock classification is reported (#769)", () => {
    const probe: typeof ROUTE_AUTHORIZATION = {
      ...ROUTE_AUTHORIZATION,
      "PATCH /api/__unlocked_probe/{id}": { kind: "authorized", by: "probe" },
    };
    const missing = Object.entries(probe)
      .filter(([r, a]) => mutating(r) && !a.locks)
      .map(([r]) => r);
    expect(missing).toEqual(["PATCH /api/__unlocked_probe/{id}"]);
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

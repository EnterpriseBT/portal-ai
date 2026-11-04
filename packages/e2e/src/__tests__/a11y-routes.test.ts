import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  A11Y_ROUTES,
  LOCK_ALERT_ROUTES,
  leafRouteFiles,
  SITE_PAGES,
} from "../lib/a11y-routes.js";

const REPO_ROOT = fileURLToPath(new URL("../../../../", import.meta.url));
const ROUTES_DIR = path.join(REPO_ROOT, "apps/web/src/routes");
const SITE_PAGES_DIR = path.join(REPO_ROOT, "apps/site/src/pages");

const routeFiles = readdirSync(ROUTES_DIR)
  .filter((f) => f.endsWith(".tsx"))
  .map((f) => f.replace(/\.tsx$/, ""));

describe("leafRouteFiles", () => {
  it("drops __root and every route another route nests under", () => {
    expect(
      leafRouteFiles([
        "__root",
        "index",
        "jobs",
        "jobs.index",
        "jobs.$jobId",
        "settings",
      ]).sort()
    ).toEqual(["index", "jobs.$jobId", "jobs.index", "settings"]);
  });
});

describe("A11Y_ROUTES", () => {
  it("covers every leaf route file in apps/web, and names no missing one", () => {
    const covered = A11Y_ROUTES.map((r) => r.route).sort();
    expect(covered).toEqual(leafRouteFiles(routeFiles).sort());
  });

  it("has unique ids", () => {
    const ids = A11Y_ROUTES.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("gives every route either a literal path or a drill, never both", () => {
    for (const r of A11Y_ROUTES) {
      expect([!!r.path, !!r.drill].filter(Boolean)).toHaveLength(1);
      if (r.path) expect(r.path).not.toMatch(/[:$]/);
    }
  });

  it("walks the sign-in pages signed out, and everything else signed in", () => {
    const signedOut = A11Y_ROUTES.filter((r) => r.signedOut).map(
      (r) => r.route
    );
    expect(signedOut.sort()).toEqual([
      "invitations.accept",
      "login",
      "not-invited",
    ]);
  });

  it("intercepts running jobs on exactly the four views that render the lock alert", () => {
    const locked = A11Y_ROUTES.filter((r) => r.states.locked).map(
      (r) => r.route
    );
    expect(locked.sort()).toEqual([...LOCK_ALERT_ROUTES].sort());
    for (const r of A11Y_ROUTES.filter((x) => x.states.locked)) {
      expect(r.states.locked).toMatch(/\/running-jobs\*$/);
    }
  });
});

describe("SITE_PAGES", () => {
  it("covers every page under apps/site/src/pages, one entry per use case", () => {
    const slugs = [
      ...readFileSync(
        path.join(REPO_ROOT, "apps/site/src/lib/use-cases.ts"),
        "utf8"
      ).matchAll(/\bslug: "([^"]+)"/g),
    ].map((m) => m[1]);
    const statics = (
      readdirSync(SITE_PAGES_DIR, { recursive: true }) as string[]
    )
      .filter((f) => f.endsWith(".astro") && !f.includes("["))
      .map((f) =>
        f
          .replace(/\.astro$/, "")
          .split(path.sep)
          .join("/")
      )
      .map((f) =>
        f === "index"
          ? "/"
          : f === "404"
            ? "/404.html"
            : `/${f.replace(/\/?index$/, "")}/`
      );
    const expected = [
      ...statics,
      ...slugs.map((s) => `/use-cases/${s}/`),
    ].sort();
    expect(slugs.length).toBeGreaterThan(0);
    expect([...SITE_PAGES].sort()).toEqual(expected);
  });
});

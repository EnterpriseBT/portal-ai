import { readdirSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  A11Y_ROUTES,
  firstId,
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

  // `/api/organization/*` also matched the shell's org switcher
  // (`/api/organization/memberships`), so faking it broke the shell too.
  it("intercepts only Settings' own request, not the shell's", () => {
    const settings = A11Y_ROUTES.find((r) => r.id === "settings")!;
    expect(Object.values(settings.states)).toEqual(
      expect.arrayContaining(["/api/organization/current"])
    );
    for (const pattern of Object.values(settings.states)) {
      expect(pattern).toBe("/api/organization/current");
    }
  });

  it("anchors every state pattern at /api/", () => {
    for (const r of A11Y_ROUTES) {
      for (const pattern of Object.values(r.states))
        expect(pattern).toMatch(/^\/api\//);
    }
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

  it("builds each drilled path from the last step's id, and visits later steps by earlier ids", () => {
    for (const r of A11Y_ROUTES.filter((x) => x.drill)) {
      const ids = r.drill!.steps.map((_, i) => `id${i}`);
      expect(r.drill!.path(ids)).toContain(ids[ids.length - 1]);
      r.drill!.steps.forEach((step, i) => {
        expect(step.api).toMatch(/^\/api\//);
        const visit =
          typeof step.visit === "string"
            ? step.visit
            : step.visit(ids.slice(0, i));
        if (i > 0) expect(visit).toContain(ids[i - 1]);
      });
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
      expect(r.states.locked).toMatch(/^\/api\/.*\/running-jobs$/);
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

describe("firstId", () => {
  const body = {
    success: true,
    payload: {
      total: 3,
      connectorInstances: [
        { id: "a", name: "Sandbox" },
        { id: "b", name: "File Upload — CSV" },
      ],
    },
  };

  it("takes the first item of the payload's list", () => {
    expect(firstId(body)).toBe("a");
  });

  it("takes the first item that matches the filter", () => {
    expect(firstId(body, /file upload/i)).toBe("b");
  });

  it("returns null when the list is empty or nothing matches", () => {
    expect(
      firstId({ success: true, payload: { items: [], total: 0 } })
    ).toBeNull();
    expect(firstId(body, /excel/i)).toBeNull();
    expect(firstId({ success: false })).toBeNull();
  });
});

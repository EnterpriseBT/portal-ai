/**
 * The public subprocessor list ⇔ what the browser app reaches (#613).
 *
 * `apps/api`'s parity test holds `SUBPROCESSORS` to the env vars the server
 * reads, but the browser opens connections of its own that no server env var
 * names: portal maps load CARTO basemap tiles (by default), the Google picker loads
 * Google's scripts, sign-in talks to Auth0. So every external host the web
 * source names, and every `VITE_*` var it reads, is classified here — as the
 * subprocessor it reaches, or as not one with a reason. A new host fails CI
 * until someone decides whether the public list must change.
 *
 * A map spec can also name its own basemap URL (`{ url }`). That host comes
 * from the portal's author at runtime, like a webhook endpoint, so it can't
 * be listed; the security page's webhook note covers the principle.
 *
 * The CARTO and OSM hosts are the `default` basemap path (#910). An install
 * whose runtime `BASEMAP_MODE` is `custom` or `none` overrides every spec's
 * basemap, so its browsers reach the operator's tile server or no tile host
 * at all; the hosts stay in source, and listed here, because SaaS uses them.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, relative } from "node:path";

import { SUBPROCESSORS, type SubprocessorId } from "@portalai/core/content";

const webSrc = join(dirname(fileURLToPath(import.meta.url)), "..");

/** Reached from the browser, and a published subprocessor. */
const HOSTS: Record<string, SubprocessorId | { notSubprocessor: string }> = {
  "basemaps.cartocdn.com": "carto",
  "tile.openstreetmap.org": "openstreetmap",
  "apis.google.com": "google",
  "accounts.google.com": "google",
  "www.googleapis.com": "google",
  "www.portalsai.io": { notSubprocessor: "our own marketing site" },
  "api-dev.portalsai.io": {
    notSubprocessor: "our own API, named in a code comment",
  },
  "api.example.com": {
    notSubprocessor: "placeholder text in a form field; never fetched",
  },
  "docs.jsonata.org": {
    notSubprocessor: "a documentation link the user may follow; sends no data",
  },
};

const VITE_VARS: Record<string, SubprocessorId | { notSubprocessor: string }> =
  {
    VITE_AUTH0_DOMAIN: "auth0",
    VITE_AUTH0_AUDIENCE: "auth0",
    VITE_AUTH0_CLIENT_ID: "auth0",
    VITE_AUTH0_QA_CONNECTION: "auth0", // #489: a connection name on the same tenant
    VITE_API_BASE_URL: { notSubprocessor: "our own API" },
    VITE_SITE_URL: { notSubprocessor: "our own marketing site" },
    VITE_APP_SHA: { notSubprocessor: "build metadata" },
    VITE_APP_VERSION: { notSubprocessor: "build metadata" },
    VITE_DEPLOY_MODE: { notSubprocessor: "build configuration" },
    VITE_SALES_EMAIL: { notSubprocessor: "a displayed address" },
    VITE_SUPPORT_EMAIL: { notSubprocessor: "a displayed address" },
  };

/** Shipped source files: no tests, stories or mocks. */
function sourceFiles(dir = webSrc): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      return ["__tests__", "__mocks__", "stories"].includes(name)
        ? []
        : sourceFiles(full);
    }
    return /\.(ts|tsx)$/.test(name) && !/\.(test|stories)\.tsx?$/.test(name)
      ? [full]
      : [];
  });
}

/** Every match of `pattern` in shipped source, with where it was first seen. */
function found(pattern: RegExp): Map<string, string> {
  const seen = new Map<string, string>();
  for (const file of sourceFiles()) {
    for (const m of readFileSync(file, "utf8").matchAll(pattern)) {
      if (!seen.has(m[1])) seen.set(m[1], relative(webSrc, file));
    }
  }
  return seen;
}

const hosts = found(/https?:\/\/([a-z0-9-]+(?:\.[a-z0-9-]+)+)/gi);
// Full names only: a `VITE_GOOGLE_` prefix in prose ends in `_` and is skipped.
const viteVars = found(/\b(VITE_[A-Z0-9_]*[A-Z0-9])\b/g);

const unclassified = (
  seen: Map<string, string>,
  map: Record<string, unknown>
): string[] =>
  [...seen.entries()]
    .filter(([name]) => !(name in map))
    .map(
      ([name, where]) =>
        `${name} (in ${where}) is unclassified: does the browser send it data?`
    );

describe("the public subprocessor list matches the browser's egress (#613)", () => {
  it("finds the hosts and vars it should (guards the guard)", () => {
    expect(hosts.has("basemaps.cartocdn.com")).toBe(true);
    expect(viteVars.has("VITE_AUTH0_DOMAIN")).toBe(true);
  });

  it("classifies every external host the web source names", () => {
    expect(unclassified(hosts, HOSTS)).toEqual([]);
  });

  it("classifies every VITE_ var the web source reads", () => {
    expect(unclassified(viteVars, VITE_VARS)).toEqual([]);
  });

  it("classifies nothing the source no longer names", () => {
    const stale = [
      ...Object.keys(HOSTS).filter((h) => !hosts.has(h)),
      ...Object.keys(VITE_VARS).filter((v) => !viteVars.has(v)),
    ];
    expect(stale).toEqual([]);
  });

  it("publishes no browser-side subprocessor the app never reaches", () => {
    // Reached means classified AND still named in the source, so swapping a
    // vendor out names both the new host and the dropped subprocessor.
    const reached = new Set(
      [
        ...Object.entries(HOSTS).filter(([host]) => hosts.has(host)),
        ...Object.entries(VITE_VARS).filter(([name]) => viteVars.has(name)),
      ]
        .map(([, v]) => v)
        .filter((v): v is SubprocessorId => typeof v === "string")
    );
    const unreached = SUBPROCESSORS.filter((s) =>
      s.reachedBy.includes("browser")
    )
      .map((s) => s.id)
      .filter((id) => !reached.has(id));
    expect(unreached).toEqual([]);
  });

  it("maps the browser only to subprocessors that say they're browser-reached", () => {
    const browserSide = new Set(
      SUBPROCESSORS.filter((s) => s.reachedBy.includes("browser")).map(
        (s) => s.id
      )
    );
    for (const v of [...Object.values(HOSTS), ...Object.values(VITE_VARS)]) {
      if (typeof v === "string") expect(browserSide).toContain(v);
    }
  });
});

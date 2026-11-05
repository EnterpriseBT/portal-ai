/**
 * The view states the accessibility walk renders (#792), produced by
 * intercepting the view's own API request rather than by seeding: the
 * markup comes from the same components either way, and interception is
 * deterministic.
 *
 * - empty:   the real response with every list emptied and totals zeroed
 * - error:   the API's error envelope with a 4xx (ERROR_STATUS)
 * - loading: the request held while axe runs
 * - locked:  the real running-jobs response plus one non-terminal job
 */
import { readFileSync } from "node:fs";

import type { Page, Route } from "@playwright/test";
import { JobSchema, type Job } from "@portalai/core/models";

import type { A11yState } from "./a11y-record.js";

const fixture = (name: string): unknown =>
  JSON.parse(
    readFileSync(new URL(`../fixtures/${name}`, import.meta.url), "utf8")
  );

export function loadRunningJobFixture(): Job {
  return JobSchema.parse(fixture("a11y-running-job.json"));
}

/**
 * The status the error state answers with. The app's query client retries a
 * 5xx three times with backoff (about 14s) and never a 4xx (`shouldRetry` in
 * apps/web/src/client.ts), and a view renders the same error component for
 * both. A 4xx shows it at once, rather than auditing the page mid-retry.
 * Not 401/403/404/429: those have their own handling (sign-out, forbidden,
 * not found, rate-limit wait).
 */
export const ERROR_STATUS = 400;

export interface ApiErrorBody {
  success: false;
  message: string;
  code: string;
}

export function loadErrorFixture(): ApiErrorBody {
  return fixture("a11y-error.json") as ApiErrorBody;
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Empties the payload's own lists and zeroes its `total`/`count`. Only the
 *  payload's top level: a list endpoint's rows live there. */
export function emptyPayload(body: unknown): unknown {
  if (!isRecord(body) || !("payload" in body)) return body;
  const payload = body.payload;
  if (Array.isArray(payload)) return { ...body, payload: [] };
  if (!isRecord(payload)) return body;
  const next: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(payload)) {
    if (Array.isArray(v)) next[k] = [];
    else if ((k === "total" || k === "count") && typeof v === "number")
      next[k] = 0;
    else next[k] = v;
  }
  return { ...body, payload: next };
}

/** Adds `job` to a running-jobs response's `payload.runningJobs`. */
export function withRunningJob(body: unknown, job: Job): unknown {
  if (
    !isRecord(body) ||
    !isRecord(body.payload) ||
    !Array.isArray(body.payload.runningJobs)
  ) {
    throw new Error("running-jobs response has no payload.runningJobs list");
  }
  return {
    ...body,
    payload: {
      ...body.payload,
      runningJobs: [...body.payload.runningJobs, job],
    },
  };
}

/**
 * A request matcher from a path pattern such as `/api/stations*` or
 * `/api/connector-entities/*` (`*` = within one path segment), tested
 * against the URL's pathname alone. Anchored at `/api/`: a Playwright glob
 * like `**\/api/stations*` also matches the dev server's own
 * `/src/api/stations.api.ts` module, and faking that breaks the page.
 */
export function apiPathMatcher(pattern: string): (url: URL) => boolean {
  if (!pattern.startsWith("/api/")) {
    throw new Error(`state pattern "${pattern}" must start with /api/`);
  }
  const source = pattern
    .split("*")
    .map((part) => part.replace(/[.+?^${}()|[\]\\]/g, "\\$&"))
    .join("[^/]*");
  const re = new RegExp(`^${source}$`);
  return (url) => re.test(url.pathname);
}

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

/**
 * Installs the interception for `state` on requests matching `pattern` (see
 * apiPathMatcher), before navigation. `release` lets "loading"'s held
 * requests through; call it after axe has run, in a finally. `failures`
 * collects any interception that couldn't produce its state, and `handled`
 * counts the requests it caught: zero means the pattern matched nothing, so
 * the page was never in that state. Either way the caller records the run
 * as skipped rather than auditing a page in the wrong state.
 */
export async function applyState(
  page: Page,
  state: Exclude<A11yState, "populated">,
  pattern: string
): Promise<{ release: () => void; failures: string[]; handled: () => number }> {
  const held: Route[] = [];
  const failures: string[] = [];
  let released = false;
  let handled = 0;
  await page.route(apiPathMatcher(pattern), async (route) => {
    handled += 1;
    try {
      await fulfil(route);
    } catch (err) {
      failures.push(
        `${state} interception of ${new URL(route.request().url()).pathname} failed: ${String(err instanceof Error ? err.message : err).split("\n")[0]}`
      );
      await route.continue().catch(() => undefined);
    }
  });
  async function fulfil(route: Route): Promise<void> {
    switch (state) {
      case "empty": {
        const res = await route.fetch();
        return json(route, res.status(), emptyPayload(await res.json()));
      }
      case "error":
        return json(route, ERROR_STATUS, loadErrorFixture());
      case "locked": {
        const res = await route.fetch();
        return json(
          route,
          res.status(),
          withRunningJob(await res.json(), loadRunningJobFixture())
        );
      }
      case "loading":
        if (released) return route.continue();
        held.push(route);
        return;
    }
  }
  return {
    failures,
    handled: () => handled,
    release: () => {
      released = true;
      for (const r of held.splice(0)) r.continue().catch(() => undefined);
    },
  };
}

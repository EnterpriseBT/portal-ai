/**
 * The view states the accessibility walk renders (#792), produced by
 * intercepting the view's own API request rather than by seeding: the
 * markup comes from the same components either way, and interception is
 * deterministic.
 *
 * - empty:   the real response with every list emptied and totals zeroed
 * - error:   the API's 500 envelope
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

const json = (route: Route, status: number, body: unknown) =>
  route.fulfill({
    status,
    contentType: "application/json",
    body: JSON.stringify(body),
  });

/**
 * Installs the interception for `state` on requests matching `glob`, before
 * navigation. For "loading", the returned `release` lets the held requests
 * through; call it after axe has run (and in a finally).
 */
export async function applyState(
  page: Page,
  state: Exclude<A11yState, "populated">,
  glob: string
): Promise<{ release: () => void }> {
  const held: Route[] = [];
  let released = false;
  await page.route(glob, async (route) => {
    switch (state) {
      case "empty": {
        const res = await route.fetch();
        return json(route, res.status(), emptyPayload(await res.json()));
      }
      case "error":
        return json(route, 500, loadErrorFixture());
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
  });
  return {
    release: () => {
      released = true;
      for (const r of held.splice(0)) r.continue().catch(() => undefined);
    },
  };
}

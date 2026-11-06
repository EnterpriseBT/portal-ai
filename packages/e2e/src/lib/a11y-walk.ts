/**
 * Browser plumbing shared by the accessibility walks (#792): theme, settling,
 * drilling into param routes, and the axe run itself. Exercised by
 * `npm run a11y:axe` / `a11y:axe:site`; the pure parts (manifest, states,
 * record) are unit-tested in their own modules.
 */
import { createRequire } from "node:module";

import AxeBuilder from "@axe-core/playwright";
import type { BrowserContext, Page } from "@playwright/test";

import { firstId, type A11yDrillStep } from "./a11y-routes.js";
import { apiFailure, apiPathMatcher } from "./a11y-states.js";
import {
  trimViolations,
  type A11yTheme,
  type RawViolation,
} from "./a11y-record.js";

/** WCAG 2.0–2.2 A and AA, plus axe's best-practice rules (which the
 *  inventory lists separately, with no criterion). */
export const AXE_TAGS = [
  "wcag2a",
  "wcag2aa",
  "wcag21a",
  "wcag21aa",
  "wcag22aa",
  "best-practice",
];

export const axeVersion = (): string =>
  (
    createRequire(import.meta.url)("axe-core/package.json") as {
      version: string;
    }
  ).version;

/** Both the app and the site read the theme from this key before first
 *  paint, so setting it before navigation renders the page in that theme. */
export async function useTheme(
  context: BrowserContext,
  theme: A11yTheme
): Promise<void> {
  await context.addInitScript((name) => {
    try {
      window.localStorage.setItem("portalai-theme", JSON.stringify(name));
    } catch {
      // Storage blocked: the page renders its default theme.
    }
  }, theme);
}

/** Waits for the page's own loading indicators to clear. Never networkidle:
 *  the app holds SSE streams open. */
export async function settle(page: Page, timeout = 15_000): Promise<void> {
  await page.waitForLoadState("load");
  // The SPA mounts after "load". Every app layout renders a main landmark
  // (#797), and so does every site page, so wait for one: under a long
  // walk's load the app can take longer than the grace below, and axe
  // would scan an empty #root (missing main and h1 by mistake).
  await page
    .locator("main")
    .first()
    .waitFor({ state: "attached", timeout })
    .catch(() => undefined);
  await page
    .locator('[role="progressbar"]')
    .first()
    .waitFor({ state: "hidden", timeout })
    .catch(() => undefined);
  // One more frame for effects that render after the data lands.
  await page.waitForTimeout(300);
}

export async function analyze(page: Page): Promise<RawViolation[]> {
  const results = await new AxeBuilder({ page }).withTags(AXE_TAGS).analyze();
  return trimViolations(results.violations);
}

/**
 * Follows a route's drill: for each step, visits its page and reads the id
 * of the first item (matching `pick`) from that page's own list request.
 * Returns the final path. Throws, naming the step, when there's nothing to
 * drill into; the caller records a skip.
 */
export async function drillTo(
  page: Page,
  drill: {
    steps: readonly A11yDrillStep[];
    path: (ids: readonly string[]) => string;
  }
): Promise<string> {
  const ids: string[] = [];
  for (const [i, step] of drill.steps.entries()) {
    const visit = typeof step.visit === "string" ? step.visit : step.visit(ids);
    const matches = apiPathMatcher(step.api);
    const response = page.waitForResponse(
      (r) => r.request().method() === "GET" && matches(new URL(r.url())),
      { timeout: 20_000 }
    );
    await page.goto(visit);
    const id = firstId(await (await response).json(), step.pick);
    if (!id) {
      throw new Error(
        `nothing to drill into at step ${i + 1}: ${step.api} on ${visit} returned no item${step.pick ? ` matching ${step.pick}` : ""}`
      );
    }
    ids.push(id);
  }
  return drill.path(ids);
}

/**
 * Starts recording API failures on `page` (see apiFailure). Call before
 * navigating; the returned function gives the first failure seen so far,
 * or null. A run whose page saw one is skipped, not recorded as its state.
 */
export function watchApiFailures(page: Page): () => string | null {
  let first: string | null = null;
  const note = (problem: string | null) => {
    if (problem && !first) first = problem;
  };
  page.on("response", (r) =>
    note(
      apiFailure({
        url: r.url(),
        method: r.request().method(),
        status: r.status(),
      })
    )
  );
  page.on("requestfailed", (r) =>
    note(
      apiFailure({
        url: r.url(),
        method: r.method(),
        failure: r.failure()?.errorText ?? "no response",
      })
    )
  );
  return () => first;
}

/** The identity's active org, read from the request Settings makes. */
export async function activeOrg(
  page: Page
): Promise<{ id: string; name: string }> {
  const matches = apiPathMatcher("/api/organization/current");
  const response = page.waitForResponse(
    (r) => r.request().method() === "GET" && matches(new URL(r.url())),
    { timeout: 20_000 }
  );
  await page.goto("/settings");
  const res = await response;
  if (!res.ok()) {
    throw new Error(`GET /api/organization/current answered ${res.status()}`);
  }
  const body = (await res.json()) as {
    payload: { organization: { id: string; name: string } };
  };
  return body.payload.organization;
}

export const reason = (err: unknown): string =>
  String(err instanceof Error ? err.message : err).split("\n")[0] ||
  "unknown error";

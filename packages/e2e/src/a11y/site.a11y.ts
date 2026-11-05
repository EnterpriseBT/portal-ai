/**
 * The marketing site accessibility walk (#792): every page in SITE_PAGES, in
 * both themes, against the built site under `astro preview` (:3002, or
 * E2E_SITE_BASE_URL). Records violations to a11y-results/site.json for
 * scripts/a11y-inventory.mjs and never fails on one.
 *
 * Preconditions: `npm run --workspace @portalai/site build`, then
 * `npm run --workspace @portalai/site preview`.
 * Run: `npm run --workspace @portalai/e2e a11y:axe:site`.
 */
import { fileURLToPath } from "node:url";

import { expect, test } from "@playwright/test";

import {
  A11Y_THEMES,
  writeRawResults,
  type RawRun,
} from "../lib/a11y-record.js";
import { SITE_PAGES } from "../lib/a11y-routes.js";
import {
  analyze,
  axeVersion,
  reason,
  settle,
  useTheme,
} from "../lib/a11y-walk.js";

const RESULTS = fileURLToPath(
  new URL("../../a11y-results/site.json", import.meta.url)
);
const runs: RawRun[] = [];

test.setTimeout(30 * 60_000);

test("walks every site page in both themes", async ({ browser, baseURL }) => {
  const probe = await fetch(baseURL!).catch((err: unknown) => err);
  if (probe instanceof Error || !(probe as Response).ok) {
    throw new Error(
      `the site isn't being served at ${baseURL}: build it and run astro preview (npm run --workspace @portalai/site preview)`
    );
  }
  for (const theme of A11Y_THEMES) {
    const context = await browser.newContext({ baseURL });
    await useTheme(context, theme);
    try {
      for (const url of SITE_PAGES) {
        const page = await context.newPage();
        try {
          await page.goto(url);
          await settle(page, 2_000);
          runs.push({
            context: { route: url, url, theme },
            status: "ok",
            violations: await analyze(page),
          });
        } catch (err) {
          runs.push({
            context: { route: url, url, theme },
            status: "skipped",
            error: reason(err),
            violations: [],
          });
        } finally {
          await page.close();
        }
      }
    } finally {
      await context.close();
    }
  }
});

test.afterAll(() => {
  writeRawResults(RESULTS, {
    tool: "axe-site",
    package: "apps/site",
    generatedAt: new Date().toISOString(),
    axeVersion: axeVersion(),
    runs,
  });
  const ok = runs.filter((r) => r.status === "ok").length;
  console.log(
    `a11y:axe:site: ${ok} page(s) checked, ${runs.length - ok} skipped → ${RESULTS}`
  );
  expect(
    ok,
    "the walk checked nothing; an empty result isn't a clean one"
  ).toBeGreaterThan(0);
});

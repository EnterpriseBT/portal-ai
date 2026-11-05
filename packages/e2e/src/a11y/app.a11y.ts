/**
 * The app accessibility walk (#792): every route in A11Y_ROUTES, as owner,
 * admin and member (the sign-in pages signed out), in each state the route
 * declares, in both themes. Records violations to a11y-results/app.json for
 * scripts/a11y-inventory.mjs and never fails on one. It fails only on setup:
 * a missing session, a session that has expired, or a run with nothing
 * checked.
 *
 * Preconditions: the dev stack, `e2e:seed`, `e2e:auth:all`.
 * Run: `npm run --workspace @portalai/e2e a11y:axe`.
 */
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

import { expect, test, type BrowserContext } from "@playwright/test";

import {
  A11Y_THEMES,
  writeRawResults,
  type A11yState,
  type RawRun,
} from "../lib/a11y-record.js";
import { A11Y_ROUTES, type A11yRoute } from "../lib/a11y-routes.js";
import { applyState } from "../lib/a11y-states.js";
import {
  analyze,
  axeVersion,
  drillTo,
  reason,
  settle,
  useTheme,
} from "../lib/a11y-walk.js";
import {
  resolveTarget,
  storageStatePath,
  type E2eIdentity,
} from "../lib/target.js";

const RESULTS = fileURLToPath(
  new URL("../../a11y-results/app.json", import.meta.url)
);
const ROLES: readonly E2eIdentity[] = ["owner", "admin", "member"];
const target = resolveTarget(process.env);
const runs: RawRun[] = [];

test.describe.configure({ mode: "serial" });
test.setTimeout(90 * 60_000);

async function walkRoute(
  context: BrowserContext,
  route: A11yRoute,
  role: E2eIdentity | null,
  theme: (typeof A11Y_THEMES)[number],
  resolved: Map<string, string | Error>
): Promise<void> {
  const base = { route: route.id, owner: route.owner, role, theme };

  let path = route.path;
  if (!path && route.drill) {
    if (!resolved.has(route.id)) {
      const page = await context.newPage();
      try {
        resolved.set(route.id, await drillTo(page, route.drill));
      } catch (err) {
        resolved.set(route.id, new Error(reason(err)));
      } finally {
        await page.close();
      }
    }
    const r = resolved.get(route.id);
    if (r instanceof Error) {
      // Every state this route declares went unaudited, so each is listed
      // as a gap, not just the populated page.
      for (const state of [
        "populated",
        ...Object.keys(route.states),
      ] as A11yState[]) {
        runs.push({
          context: { ...base, state },
          status: "skipped",
          error: r.message,
          violations: [],
        });
      }
      return;
    }
    path = r;
  }

  const states: A11yState[] = [
    "populated",
    ...(Object.keys(route.states) as A11yState[]),
  ];
  for (const state of states) {
    const page = await context.newPage();
    let release = () => {};
    let failures: string[] = [];
    let handled = () => 1;
    try {
      if (state !== "populated") {
        ({ release, failures, handled } = await applyState(
          page,
          state,
          route.states[state]!
        ));
      }
      await page.goto(path!);
      if (
        !route.signedOut &&
        /\/login\/?$/.test(new URL(page.url()).pathname)
      ) {
        throw new SessionExpired(role);
      }
      if (state === "loading") {
        await page
          .locator('[role="progressbar"]')
          .first()
          .waitFor({ state: "visible", timeout: 10_000 })
          .catch(() => undefined);
      } else {
        await settle(page);
      }
      const violations = await analyze(page);
      if (failures.length) throw new Error(failures[0]);
      if (handled() === 0) {
        // The pattern matched no request, so the page never entered this
        // state; recording it would label the populated page as this one.
        throw new Error(
          `no request matched ${route.states[state as Exclude<A11yState, "populated">]}, so the page never entered the ${state} state`
        );
      }
      runs.push({
        context: { ...base, url: path, state },
        status: "ok",
        violations,
      });
    } catch (err) {
      if (err instanceof SessionExpired) throw err;
      runs.push({
        context: { ...base, url: path, state },
        status: "skipped",
        error: reason(err),
        violations: [],
      });
    } finally {
      release();
      await page.close();
    }
  }
}

class SessionExpired extends Error {
  constructor(role: E2eIdentity | null) {
    super(
      `the ${role} session has expired (the app redirected to /login): run npm run e2e:auth:all`
    );
  }
}

for (const role of ROLES) {
  test(`walks every route as ${role}`, async ({ browser }) => {
    const storageState = storageStatePath(target, role);
    if (!existsSync(storageState)) {
      throw new Error(
        `${storageState} is missing: run npm run --workspace @portalai/e2e e2e:auth:all`
      );
    }
    const resolved = new Map<string, string | Error>();
    for (const theme of A11Y_THEMES) {
      const context = await browser.newContext({ storageState });
      await useTheme(context, theme);
      try {
        for (const route of A11Y_ROUTES.filter(
          (r) => !r.signedOut && (r.roles ?? ROLES).includes(role)
        )) {
          await walkRoute(context, route, role, theme, resolved);
        }
      } finally {
        await context.close();
      }
    }
  });
}

test("walks the sign-in pages signed out", async ({ browser }) => {
  for (const theme of A11Y_THEMES) {
    const context = await browser.newContext();
    await useTheme(context, theme);
    try {
      for (const route of A11Y_ROUTES.filter((r) => r.signedOut)) {
        await walkRoute(context, route, null, theme, new Map());
      }
    } finally {
      await context.close();
    }
  }
});

test.afterAll(() => {
  writeRawResults(RESULTS, {
    tool: "axe-app",
    package: "apps/web",
    generatedAt: new Date().toISOString(),
    axeVersion: axeVersion(),
    runs,
  });
  const ok = runs.filter((r) => r.status === "ok").length;
  console.log(
    `a11y:axe: ${ok} page state(s) checked, ${runs.length - ok} skipped → ${RESULTS}`
  );
  expect(
    ok,
    "the walk checked nothing; an empty result isn't a clean one"
  ).toBeGreaterThan(0);
});

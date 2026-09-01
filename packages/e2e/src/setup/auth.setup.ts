/**
 * `e2e:auth` (#304) — drive the app's login ONCE and persist the resulting
 * Auth0 SPA session as a reusable Playwright `storageState`, so the agent
 * browser session and (future) specs never re-drive login.
 *
 * The app's normal login is Google-only, which a headless test user cannot
 * drive. This script instead uses the guarded dev affordance (`/?e2e=1` →
 * "Dev sign-in (E2E)" button) which triggers Auth0 Universal Login with no
 * pinned connection, so a **Database-connection** test user can sign in with a
 * username/password. auth0-spa-js (running with `cacheLocation: "localstorage"`)
 * writes its own cache on the callback, so `storageState` captures the real
 * session shape — nothing is hand-assembled.
 *
 * Prerequisites (operator, not code — see packages/e2e/README.md):
 *   - the dev stack is running (`npm run dev`),
 *   - the dev Auth0 tenant has a Database connection with a test user,
 *   - env: E2E_AUTH0_USERNAME, E2E_AUTH0_PASSWORD (dev shell only; never
 *     committed), optional E2E_BASE_URL (default http://localhost:3000).
 *
 * Selectors for the Auth0-hosted form are best-effort against New Universal
 * Login and may need a one-time tune on first run against the real tenant.
 */
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const USERNAME = process.env.E2E_AUTH0_USERNAME;
const PASSWORD = process.env.E2E_AUTH0_PASSWORD;
const STORAGE_STATE = resolve(process.cwd(), ".auth/storageState.json");

function fail(message: string): never {
  console.error(`[e2e:auth] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  if (!USERNAME || !PASSWORD) {
    fail(
      "E2E_AUTH0_USERNAME and E2E_AUTH0_PASSWORD must be set (the dev-tenant " +
        "Database-connection test user). See packages/e2e/README.md."
    );
  }

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    // Guarded dev affordance: ?e2e reveals a Universal-Login button that does
    // not pin the Google connection.
    await page.goto(`${BASE_URL}/?e2e=1`, { waitUntil: "domcontentloaded" });
    await page.getByTestId("e2e-dev-login").click({ timeout: 15_000 });

    // Auth0 New Universal Login (identifier-first OR combined) — handle both.
    await page.waitForURL(/\/(u\/login|login|authorize)/, { timeout: 30_000 });
    await page
      .locator('input[name="username"], input#username')
      .first()
      .fill(USERNAME);

    const password = page
      .locator('input[name="password"], input#password')
      .first();
    if (!(await password.isVisible().catch(() => false))) {
      // identifier-first flow: advance to the password step
      await page
        .getByRole("button", { name: /continue|next/i })
        .first()
        .click();
    }
    await password.waitFor({ state: "visible", timeout: 15_000 });
    await password.fill(PASSWORD);
    await page
      .getByRole("button", { name: /continue|log in|sign in/i })
      .first()
      .click();

    // App-DOM-agnostic success signal: we are back on the app origin AND
    // auth0-spa-js has written its localStorage cache after the redirect
    // callback. Waiting on this (not a specific dashboard element) keeps the
    // fixture decoupled from app markup.
    const origin = new URL(BASE_URL).origin;
    await page.waitForURL((url) => url.origin === origin, { timeout: 45_000 });
    await page.waitForFunction(
      () =>
        Object.keys(window.localStorage).some((k) =>
          k.startsWith("@@auth0spajs@@")
        ),
      undefined,
      { timeout: 30_000 }
    );

    mkdirSync(dirname(STORAGE_STATE), { recursive: true });
    await context.storageState({ path: STORAGE_STATE });
    console.log(`[e2e:auth] storage state written to ${STORAGE_STATE}`);
  } catch (err) {
    // Never leave a partial/stale state behind on failure.
    fail(
      `login flow failed before a session was captured: ${
        err instanceof Error ? err.message : String(err)
      }. No storage state written. Is the dev stack up at ${BASE_URL}, and is ` +
        "the test user valid in the dev tenant?"
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

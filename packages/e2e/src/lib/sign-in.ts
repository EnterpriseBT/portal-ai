/**
 * Drive an Auth0 Universal Login for a Database-connection user (#304, #489).
 *
 * Enters through one of the app's two guarded affordances, fills Universal
 * Login (identifier-first or combined), and resolves once auth0-spa-js has
 * written its localStorage cache on the callback. Shared by `e2e:auth`, the
 * Playwright `setup` project and the `login` spec, so every tier signs in the
 * same way.
 */

import type { Page } from "@playwright/test";

import type { SignInVia } from "./target.js";

export interface SignInOptions {
  baseUrl: string;
  username: string;
  password: string;
  via: SignInVia;
  /** Start here instead of the affordance's own path (an invite link); the
   *  affordance flag joins its query, and the redirect to /login keeps both. */
  entryPath?: string;
}

/** A failed sign-in. The message never contains the password. */
export class E2eSignInError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "E2eSignInError";
  }
}

/** Where each affordance lives: `?e2e` is DEV-only, `?qa` is build-flagged. */
export function signInEntry(via: SignInVia): { path: string; testId: string } {
  return via === "qa"
    ? { path: "/login?qa=1", testId: "e2e-qa-login" }
    : { path: "/?e2e=1", testId: "e2e-dev-login" };
}

/** The URL a sign-in starts at. */
export function signInUrl(
  baseUrl: string,
  via: SignInVia,
  entryPath?: string
): string {
  const entry = signInEntry(via);
  if (!entryPath) return `${baseUrl}${entry.path}`;
  const url = new URL(entryPath, baseUrl);
  url.searchParams.set(via === "qa" ? "qa" : "e2e", "1");
  return url.toString();
}

export async function signIn(page: Page, opts: SignInOptions): Promise<void> {
  const { baseUrl, username, password, via, entryPath } = opts;
  const entry = signInEntry(via);
  try {
    await page.goto(signInUrl(baseUrl, via, entryPath), {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId(entry.testId).click({ timeout: 15_000 });

    // Leaving the app is the signal that the affordance reached Auth0. A path
    // match would already be true on the app's own /login.
    const origin = new URL(baseUrl).origin;
    await page.waitForURL((url) => url.origin !== origin, { timeout: 30_000 });

    // Auth0 New Universal Login (identifier-first OR combined) — handle both.
    await page
      .locator('input[name="username"], input#username')
      .first()
      .fill(username);

    const passwordInput = page
      .locator('input[name="password"], input#password')
      .first();
    if (!(await passwordInput.isVisible().catch(() => false))) {
      // identifier-first flow: advance to the password step
      await page
        .getByRole("button", { name: /continue|next/i })
        .first()
        .click();
    }
    await passwordInput.waitFor({ state: "visible", timeout: 15_000 });
    await passwordInput.fill(password);
    await page
      .getByRole("button", { name: /continue|log in|sign in/i })
      .first()
      .click();

    // App-DOM-agnostic success signal: back on the app origin AND
    // auth0-spa-js has written its localStorage cache after the callback.
    await page.waitForURL((url) => url.origin === origin, { timeout: 45_000 });
    await page.waitForFunction(
      () =>
        Object.keys(window.localStorage).some((k) =>
          k.startsWith("@@auth0spajs@@")
        ),
      undefined,
      { timeout: 30_000 }
    );
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const message = password ? raw.split(password).join("***") : raw;
    throw new E2eSignInError(
      `sign-in via ${via} at ${baseUrl} failed: ${message}`
    );
  }
}

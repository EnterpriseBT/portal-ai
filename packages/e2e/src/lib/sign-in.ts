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

/** Fills a race can undo before the form is given up on (#963). A failed
 *  check never submits, so retries never count against Auth0's brute-force
 *  protection. */
export const MAX_FILL_ATTEMPTS = 3;

const USERNAME_INPUT = 'input[name="username"], input#username';
const PASSWORD_INPUT = 'input[name="password"], input#password';
/** Auth0 Universal Login's field and form error elements. */
const AUTH0_ERRORS = '[id^="error-element"], [role="alert"]';

export async function signIn(page: Page, opts: SignInOptions): Promise<void> {
  const { baseUrl, username, password, via, entryPath } = opts;
  const entry = signInEntry(via);
  const redact = (text: string) =>
    password ? text.split(password).join("***") : text;
  try {
    await page.goto(signInUrl(baseUrl, via, entryPath), {
      waitUntil: "domcontentloaded",
    });
    await page.getByTestId(entry.testId).click({ timeout: 15_000 });

    // Leaving the app is the signal that the affordance reached Auth0. A path
    // match would already be true on the app's own /login.
    const origin = new URL(baseUrl).origin;
    await page.waitForURL((url) => url.origin !== origin, { timeout: 30_000 });
    // Auth0 autofocuses its username field as its page finishes loading, and
    // a focus move between `fill`'s focus and its typing sends the text to
    // the wrong field (#963). Waiting narrows that window; the read-backs
    // below close it.
    await page.waitForLoadState("load", { timeout: 30_000 });

    // Auth0 New Universal Login (identifier-first OR combined) — handle both.
    const usernameInput = page.locator(USERNAME_INPUT).first();
    const passwordInput = page.locator(PASSWORD_INPUT).first();

    await fillChecked(async () => {
      await usernameInput.fill(username);
      return (await usernameInput.inputValue()) === username;
    }, "username");

    const combined = await passwordInput.isVisible().catch(() => false);
    if (!combined) {
      // identifier-first flow: advance to the password step
      await page
        .getByRole("button", { name: /continue|next/i })
        .first()
        .click();
    }
    await passwordInput.waitFor({ state: "visible", timeout: 15_000 });

    // The submit fires only on a form holding exactly these values, so a
    // password typed into the email field is never sent anywhere.
    await fillChecked(
      async () => {
        await passwordInput.fill(password);
        if (combined && (await usernameInput.inputValue()) !== username) {
          // The race put the password into the username field: restore it.
          await usernameInput.fill(username);
          return false;
        }
        return (await passwordInput.inputValue()) === password;
      },
      combined ? "username" : "password"
    );

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
    const where = await describePage(page);
    // Playwright screenshots the page once the test fails, and CI uploads
    // the screenshot to a public artifact. Whatever was typed (in whichever
    // field) must not be on it, so the page is left blank; Auth0's own
    // message travels in the error instead.
    await page.goto("about:blank").catch(() => undefined);
    throw new E2eSignInError(
      redact(`sign-in via ${via} at ${baseUrl} failed: ${raw}${where}`)
    );
  }
}

/** Runs `attempt` until it reports the form holds what was typed. */
async function fillChecked(
  attempt: () => Promise<boolean>,
  field: "username" | "password"
): Promise<void> {
  for (let i = 0; i < MAX_FILL_ATTEMPTS; i += 1) {
    if (await attempt()) return;
  }
  throw new Error(
    `the ${field} field didn't hold the expected value after ${MAX_FILL_ATTEMPTS} fills; the form was not submitted`
  );
}

/** The page's path and Auth0's visible error text, for the failure message.
 *  The query is dropped: Auth0's carries the login transaction's state. */
async function describePage(page: Page): Promise<string> {
  try {
    const url = new URL(page.url());
    const errors = (await page.locator(AUTH0_ERRORS).allInnerTexts())
      .map((t) => t.trim())
      .filter(Boolean);
    return ` (on ${url.host}${url.pathname}${
      errors.length ? `; the page said: ${errors.join(" | ")}` : ""
    })`;
  } catch {
    return "";
  }
}

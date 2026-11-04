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

/** The whole sign-in's budget. It sits under the Playwright test timeout
 *  (180s, playwright-config.ts) so a hung action still reaches the cleanup
 *  below; a test timeout would screenshot the live form instead. */
export const SIGN_IN_DEADLINE_MS = 150_000;

const USERNAME_INPUT = 'input[name="username"], input#username';
const PASSWORD_INPUT = 'input[name="password"], input#password';
/** Auth0 Universal Login's field and form error elements. */
const AUTH0_ERRORS = '[id^="error-element"], [role="alert"]';

type Field = "username" | "password";

export async function signIn(
  page: Page,
  opts: SignInOptions & { deadlineMs?: number }
): Promise<void> {
  const { baseUrl, password, via } = opts;
  const walk = walkSignIn(page, opts);
  // A walk abandoned at the deadline may still reject later; nothing awaits it.
  walk.catch(() => undefined);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const deadlineMs = opts.deadlineMs ?? SIGN_IN_DEADLINE_MS;
  const deadline = new Promise<never>((_, reject) => {
    timer = setTimeout(
      () =>
        reject(new Error(`sign-in didn't finish within ${deadlineMs / 1000}s`)),
      deadlineMs
    );
  });
  try {
    await Promise.race([walk, deadline]);
  } catch (err) {
    const raw = err instanceof Error ? err.message : String(err);
    const where = await describePage(page);
    // Playwright screenshots the page once the test fails, and CI uploads
    // the screenshot to a public artifact. Whatever was typed (in whichever
    // field) must not be on it, so the page is left blank; Auth0's own
    // message travels in the error instead.
    await page.goto("about:blank").catch(() => undefined);
    throw new E2eSignInError(
      scrub(`sign-in via ${via} at ${baseUrl} failed: ${raw}${where}`, password)
    );
  } finally {
    clearTimeout(timer);
  }
}

async function walkSignIn(page: Page, opts: SignInOptions): Promise<void> {
  const { baseUrl, username, password, via, entryPath } = opts;
  const entry = signInEntry(via);
  await page.goto(signInUrl(baseUrl, via, entryPath), {
    waitUntil: "domcontentloaded",
  });
  await page.getByTestId(entry.testId).click({ timeout: 15_000 });

  // Leaving the app is the signal that the affordance reached Auth0. A path
  // match would already be true on the app's own /login. waitForURL waits
  // for the page's `load` too.
  const origin = new URL(baseUrl).origin;
  await page.waitForURL((url) => url.origin !== origin, { timeout: 30_000 });

  // Auth0 New Universal Login (identifier-first OR combined) — handle both.
  // Auth0 autofocuses its username field as its page finishes loading, and a
  // focus move between `fill`'s focus and its typing sends the text to the
  // wrong field (#963). So every fill is read back, and the submit fires only
  // on a form holding exactly these values: a password typed into the email
  // field is never sent anywhere.
  const usernameInput = page.locator(USERNAME_INPUT).first();
  const passwordInput = page.locator(PASSWORD_INPUT).first();
  const holds = async (input: typeof usernameInput, value: string) =>
    (await input.inputValue()) === value;

  await usernameInput.fill(username);
  const combined = await passwordInput.isVisible().catch(() => false);
  if (combined) {
    await fillChecked(async () => {
      await usernameInput.fill(username);
      await passwordInput.fill(password);
      if (!(await holds(usernameInput, username))) return "username";
      if (!(await holds(passwordInput, password))) return "password";
      return null;
    });
  } else {
    // identifier-first flow: check the username, then advance to the
    // password step, where the username is no longer an input.
    await fillChecked(async () => {
      if (await holds(usernameInput, username)) return null;
      await usernameInput.fill(username);
      return (await holds(usernameInput, username)) ? null : "username";
    });
    await page
      .getByRole("button", { name: /continue|next/i })
      .first()
      .click();
    await passwordInput.waitFor({ state: "visible", timeout: 15_000 });
    await fillChecked(async () => {
      await passwordInput.fill(password);
      return (await holds(passwordInput, password)) ? null : "password";
    });
  }

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
}

/** Runs `attempt` until the form holds what was typed; it returns the field
 *  that didn't, or null. */
async function fillChecked(
  attempt: () => Promise<Field | null>
): Promise<void> {
  let wrong: Field | null = null;
  for (let i = 0; i < MAX_FILL_ATTEMPTS; i += 1) {
    wrong = await attempt();
    if (!wrong) return;
  }
  throw new Error(
    `the ${wrong} field didn't hold the expected value after ${MAX_FILL_ATTEMPTS} fills; the form was not submitted`
  );
}

/**
 * A failure message for a public log: the password redacted (as given, and as
 * Playwright escapes it inside quotes), and every URL's query dropped, since
 * Auth0's carries the login transaction's state.
 */
function scrub(text: string, password: string): string {
  let out = text.replace(/(https?:\/\/[^\s"'?#]+)\?[^\s"')]*/g, "$1?…");
  if (password) {
    const variants = new Set([password, JSON.stringify(password).slice(1, -1)]);
    for (const v of variants) out = out.split(v).join("***");
  }
  return out;
}

/** The page's path and Auth0's visible error text, for the failure message. */
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

/**
 * `e2e:auth` (#304, #489) — drive the app's login ONCE and persist the
 * resulting Auth0 SPA session as a reusable Playwright `storageState`, so the
 * agent browser session never re-drives login.
 *
 * The app's normal login is Google-only, which a headless test user cannot
 * drive. Locally this enters through the guarded dev affordance (`/?e2e=1` →
 * "Dev sign-in (E2E)"); against a deployed env (`--env app-dev|prod`) through
 * the build-flagged QA sign-in (`/login?qa=1`), as that env's QA identity.
 * Either way Auth0 Universal Login takes a **Database-connection** user's
 * username/password. auth0-spa-js (running with `cacheLocation:
 * "localstorage"`) writes its own cache on the callback, so `storageState`
 * captures the real session shape — nothing is hand-assembled. The file holds
 * a refresh token: it is written mode 0600 under the git-ignored `.auth/`.
 *
 * Targets and identities (see src/lib/target.ts):
 *   - local (default): `--identity <name>` (or `E2E_IDENTITY`) picks a named
 *     role (#620); creds from `E2E_AUTH0_USERNAME[_<ID>]` /
 *     `E2E_AUTH0_PASSWORD[_<ID>]`; written to `.auth/<id>.storageState.json`
 *     (`owner` when none). Optional E2E_BASE_URL.
 *   - `--env app-dev|prod` (or `E2E_TARGET`): the QA owner, admin or member;
 *     creds from the same env vars if set, else that env's Secrets Manager
 *     (`portalai/<env>/qa-auth0-*[-<id>]`, ambient AWS credentials); written
 *     to `.auth/<env>/<id>.storageState.json`.
 *   - Signing in the owner also refreshes the env's active state, the file its
 *     MCP server loads; `e2e:use <role>` switches to another identity.
 *   - `--invite <link>`: a role user's first sign-in, through its invite link,
 *     so it joins the inviting org instead of provisioning one of its own.
 *
 * Prerequisites (operator, not code — see packages/e2e/README.md).
 *
 * Selectors for the Auth0-hosted form are best-effort against New Universal
 * Login and may need a one-time tune on first run against a new tenant.
 */
import { chromium } from "@playwright/test";
import { chmodSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";

import { parseAuthArgs } from "../lib/auth-args.js";
import { acceptInvitation } from "../lib/invite.js";
import { signIn } from "../lib/sign-in.js";
import {
  normalizeIdentity,
  resolveCredentials,
  storageStatePath,
} from "../lib/target.js";
import { useIdentity } from "../lib/use-identity.js";

function fail(message: string): never {
  console.error(`[e2e:auth] ${message}`);
  process.exit(1);
}

async function main(): Promise<void> {
  const { target, identity, inviteUrl } = parseAuthArgs(
    process.argv.slice(2),
    process.env
  );
  const name = normalizeIdentity(target, identity);
  const storagePath = storageStatePath(target, identity);
  const { username, password } = await resolveCredentials(target, {
    identity,
  });

  const browser = await chromium.launch();
  const context = await browser.newContext();
  const page = await context.newPage();

  try {
    const opts = {
      baseUrl: target.baseUrl,
      username,
      password,
      via: target.via,
    };
    if (inviteUrl) {
      const org = await acceptInvitation(page, { ...opts, inviteUrl });
      console.log(`[e2e:auth] ${name} joined ${org}`);
    } else {
      await signIn(page, opts);
    }
    mkdirSync(dirname(storagePath), { recursive: true, mode: 0o700 });
    await context.storageState({ path: storagePath });
    chmodSync(storagePath, 0o600);
    console.log(`[e2e:auth] storage state written to ${storagePath}`);
    if (name === "owner") {
      console.log(
        `[e2e:auth] active ${target.name} session: ${useIdentity(target, name)}`
      );
    }
  } catch (err) {
    // Never leave a partial/stale state behind on failure.
    fail(
      `${err instanceof Error ? err.message : String(err)}. No storage state ` +
        `written. Is ${target.baseUrl} up, and is the ` +
        (target.deployed
          ? `${target.name} QA user set up (packages/e2e/README.md)?`
          : "test user valid in the dev tenant?")
    );
  } finally {
    await browser.close();
  }
}

main().catch((err) => fail(err instanceof Error ? err.message : String(err)));

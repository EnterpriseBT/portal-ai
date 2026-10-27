/**
 * The `setup` project (#489): sign in once so the `core-loop` walk starts
 * authenticated. On a fresh database this first login is also what
 * provisions the org the walk exercises (the API self-provisions a user and
 * a personal org on an unknown subject's first request).
 */
import { test as setup } from "@playwright/test";
import { chmodSync } from "node:fs";

import { SESSION_STORAGE_STATE } from "../lib/playwright-config.js";
import { signIn } from "../lib/sign-in.js";
import { resolveCredentials, resolveTarget } from "../lib/target.js";

setup("sign in once for the walk", async ({ page }) => {
  const target = resolveTarget();
  setup.skip(target.deployed, "the core loop runs on the ephemeral stack only");
  const { username, password } = await resolveCredentials(target);
  await signIn(page, {
    baseUrl: target.baseUrl,
    username,
    password,
    via: target.via,
  });
  // Holds a refresh token, like every session file the harness writes.
  await page.context().storageState({ path: SESSION_STORAGE_STATE });
  chmodSync(SESSION_STORAGE_STATE, 0o600);
});

/**
 * The login check (#489), runnable against any target: the post-deploy job
 * runs it alone against app-dev / prod as that env's QA identity.
 *
 * "Back on the app" is not enough — a sign-in loop (#873) also lands there,
 * then bounces. So it waits for the app's own authenticated
 * `GET /api/organization/current` to answer 200, then checks the identity
 * belongs to exactly one org (the QA identity's isolation invariant; a fresh
 * CI user's first login provisions exactly one), and that the app renders.
 *
 * Deployed, that one org must be the QA org: a QA user removed from it would
 * self-provision a new org on sign-in and still count one membership.
 */
import { expect, test } from "@playwright/test";

import { signIn } from "../lib/sign-in.js";
import {
  resolveCredentials,
  resolveQaOrgId,
  resolveTarget,
} from "../lib/target.js";

const BUDGET_MS = 30_000;

test("signs in and lands in exactly one org", async ({ page }) => {
  const target = resolveTarget();
  // The post-deploy check signs in as the owner; E2E_IDENTITY runs the same
  // check as a deployed env's QA admin or member (the runbook's
  // one-membership check).
  const { username, password } = await resolveCredentials(target, {
    identity: process.env.E2E_IDENTITY || undefined,
  });
  const qaOrgId = await resolveQaOrgId(target);

  const current = page.waitForResponse(
    (r) =>
      r.request().method() === "GET" &&
      new URL(r.url()).pathname === "/api/organization/current",
    { timeout: BUDGET_MS + 90_000 }
  );
  await signIn(page, {
    baseUrl: target.baseUrl,
    username,
    password,
    via: target.via,
  });

  const res = await current;
  expect(res.status(), "GET /api/organization/current").toBe(200);
  const authorization = res.request().headers()["authorization"];
  // The API the app itself called, which E2E_BASE_URL may have repointed.
  const api = new URL(res.url()).origin;
  const memberships = await page.request.get(
    `${api}/api/organization/memberships`,
    { headers: { authorization } }
  );
  expect(memberships.status()).toBe(200);
  const body = (await memberships.json()) as {
    payload: { memberships: { organization: { id: string } }[] };
  };
  const orgIds = body.payload.memberships.map((m) => m.organization.id);
  expect(orgIds, "memberships of the signed-in identity").toHaveLength(1);
  if (qaOrgId) {
    expect(orgIds, "the signed-in identity's only org is the QA org").toEqual([
      qaOrgId,
    ]);
    const currentBody = (await res.json()) as {
      payload: { organization: { id: string } };
    };
    expect(currentBody.payload.organization.id, "current org").toBe(qaOrgId);
  }

  await expect(page.getByRole("heading", { name: "Dashboard" })).toBeVisible({
    timeout: BUDGET_MS,
  });
});

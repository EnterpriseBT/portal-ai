/**
 * The invitation round trip (#489), shared by the `roles` spec and
 * `e2e:auth --invite`: an owner or admin creates an invite link in Settings →
 * Members, and a signed-out invitee follows it through sign-in to the accept
 * page (#884's return-to), which accepts on mount.
 */

import type { Page } from "@playwright/test";

import { E2eSignInError, signIn, type SignInOptions } from "./sign-in.js";

const ACCEPT_PATH = "/api/organization/invitations/accept";

/** As a signed-in owner/admin, invite `email` as `role`; returns the one-time
 *  link the Members tab shows. */
export async function createInvitation(
  page: Page,
  opts: { baseUrl: string; email: string; role: "admin" | "member" }
): Promise<string> {
  await page.goto(`${opts.baseUrl}/settings`);
  await page.getByRole("tab", { name: "Members" }).click();
  await page.getByRole("button", { name: "Invite member" }).click();
  const dialog = page.getByRole("dialog", { name: "Invite a member" });
  await dialog.getByLabel("Email").fill(opts.email);
  await dialog.getByLabel("Role").click();
  await page.getByRole("option", { name: opts.role, exact: true }).click();
  await dialog.getByRole("button", { name: "Invite", exact: true }).click();
  await dialog.waitFor({ state: "hidden" });
  const link = page.getByLabel("Invite link");
  await link.waitFor();
  const url = await link.inputValue();
  if (!url.includes("/invitations/accept?token=")) {
    throw new Error(`unexpected invite link shape: ${url.split("?")[0]}`);
  }
  return url;
}

/**
 * Signed out, follow `inviteUrl` through sign-in; resolves with the joined
 * org's name once the accept succeeds. Any other outcome (expired, invalid,
 * signed in as someone else) throws, naming the page's message.
 */
export async function acceptInvitation(
  page: Page,
  opts: SignInOptions & { inviteUrl: string }
): Promise<string> {
  const { inviteUrl, ...signInOpts } = opts;
  const target = new URL(inviteUrl);
  const accepted = page.waitForResponse(
    (r) =>
      r.request().method() === "POST" &&
      new URL(r.url()).pathname === ACCEPT_PATH,
    { timeout: 120_000 }
  );
  await signIn(page, {
    ...signInOpts,
    entryPath: `${target.pathname}${target.search}`,
  });
  const res = await accepted;
  if (!res.ok()) {
    const title = await page
      .getByRole("heading", { level: 1 })
      .first()
      .textContent({ timeout: 10_000 })
      .catch(() => null);
    throw new E2eSignInError(
      `accepting the invitation failed (${res.status()}): ${title ?? "no message shown"}`
    );
  }
  const body = (await res.json()) as {
    payload: { organization: { name: string } };
  };
  return body.payload.organization.name;
}

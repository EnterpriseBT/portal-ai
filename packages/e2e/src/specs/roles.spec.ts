/**
 * The role split on a freshly provisioned org (#489): the owner invites an
 * admin and a member, each signs in through its invite link (so it joins the
 * owner's org instead of provisioning its own, #884), and each sees what its
 * system role allows. Every affordance a role must not see is paired with the
 * server refusing it, because hiding an action is never the boundary (#684).
 *
 * The probes follow the system roles' defaults (`permission.service.ts`):
 * `org.delete` is owner-only and `member.invite` is owner/admin. Changing
 * those defaults is a deliberate edit to this table.
 */
import {
  expect,
  test,
  type Browser,
  type Page,
  type Request,
} from "@playwright/test";

import { acceptInvitation, createInvitation } from "../lib/invite.js";
import { resolveCredentials, resolveTarget } from "../lib/target.js";

/** Console errors fail the walk; list one here only with a reason. */
const ALLOWED_CONSOLE: RegExp[] = [];

/** A `.strict()`-valid org delete that names the wrong org, so a permission
 *  regression answers 400 CONFIRMATION_MISMATCH rather than deleting. */
const WRONG_CONFIRMATION = { confirmationName: "e2e: not this org's name" };

const isCurrentOrg = (r: Request) =>
  r.method() === "GET" &&
  new URL(r.url()).pathname === "/api/organization/current";

function collectConsoleErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (!ALLOWED_CONSOLE.some((re) => re.test(text))) errors.push(text);
  });
  return errors;
}

/** Open Settings and read the org and the bearer token the app itself sent,
 *  so the server probes go out as exactly this signed-in identity. */
async function openSettings(page: Page) {
  const current = page.waitForResponse((r) => isCurrentOrg(r.request()));
  await page.goto("/settings");
  const res = await current;
  expect(res.status(), "GET /api/organization/current").toBe(200);
  const body = (await res.json()) as {
    payload: { organization: { id: string; name: string } };
  };
  return {
    org: body.payload.organization,
    authorization: res.request().headers()["authorization"],
    // The API the app itself called, which E2E_BASE_URL may have repointed.
    api: new URL(res.url()).origin,
  };
}

/** The Organization tab's usage card renders with the danger zone, so once
 *  it shows, an absent Delete organization is really absent. */
async function deleteOrgVisible(page: Page): Promise<boolean> {
  await page.getByRole("tab", { name: "Organization" }).click();
  await expect(
    page.getByRole("button", { name: "Itemized usage" })
  ).toBeVisible();
  return page.getByRole("button", { name: "Delete organization" }).isVisible();
}

async function signInByInvite(
  browser: Browser,
  identity: "admin" | "member",
  inviteUrl: string
) {
  const target = resolveTarget();
  const { username, password } = await resolveCredentials(target, {
    identity,
  });
  const context = await browser.newContext({ storageState: undefined });
  const page = await context.newPage();
  const consoleErrors = collectConsoleErrors(page);
  const joined = await acceptInvitation(page, {
    baseUrl: target.baseUrl,
    username,
    password,
    via: target.via,
    inviteUrl,
  });
  return { context, page, consoleErrors, joined };
}

test.describe.configure({ mode: "serial" });

test("owner, admin and member each get their role's split", async ({
  page,
  browser,
}) => {
  const target = resolveTarget();
  test.skip(target.deployed, "the role split runs on the ephemeral stack only");
  const ownerConsole = collectConsoleErrors(page);

  const owner = await openSettings(page);
  let adminLink = "";
  let memberLink = "";

  await test.step("owner: Members and Delete organization", async () => {
    await expect(page.getByRole("tab", { name: "Members" })).toBeVisible();
    expect(await deleteOrgVisible(page)).toBe(true);
  });

  await test.step("owner invites an admin and a member", async () => {
    const env = process.env;
    for (const v of ["E2E_AUTH0_USERNAME_ADMIN", "E2E_AUTH0_USERNAME_MEMBER"]) {
      if (!env[v]) throw new Error(`${v} must be set for the roles spec`);
    }
    adminLink = await createInvitation(page, {
      baseUrl: target.baseUrl,
      email: env.E2E_AUTH0_USERNAME_ADMIN!,
      role: "admin",
    });
    memberLink = await createInvitation(page, {
      baseUrl: target.baseUrl,
      email: env.E2E_AUTH0_USERNAME_MEMBER!,
      role: "member",
    });
  });

  for (const role of ["admin", "member"] as const) {
    await test.step(`${role}: joins through the invite link`, async () => {
      const session = await signInByInvite(
        browser,
        role,
        role === "admin" ? adminLink : memberLink
      );
      try {
        expect(session.joined).toBe(owner.org.name);

        const { org, authorization, api } = await openSettings(session.page);
        expect(org.id, `${role}'s current org`).toBe(owner.org.id);

        // No personal org was provisioned on the way in (#884).
        const memberships = await session.page.request.get(
          `${api}/api/organization/memberships`,
          { headers: { authorization } }
        );
        expect(memberships.status()).toBe(200);
        const body = (await memberships.json()) as {
          payload: { memberships: { organization: { id: string } }[] };
        };
        expect(
          body.payload.memberships.map((m) => m.organization.id),
          `${role}'s memberships`
        ).toEqual([owner.org.id]);

        if (role === "admin") {
          await expect(
            session.page.getByRole("tab", { name: "Members" })
          ).toBeVisible();
          await session.page.getByRole("tab", { name: "Members" }).click();
          await expect(
            session.page.getByRole("button", { name: "Invite member" })
          ).toBeVisible();
          expect(await deleteOrgVisible(session.page)).toBe(false);

          const del = await session.page.request.delete(
            `${api}/api/organization/${owner.org.id}`,
            { headers: { authorization }, data: WRONG_CONFIRMATION }
          );
          expect(del.status(), "admin DELETE /api/organization/:id").toBe(403);
          expect(((await del.json()) as { code: string }).code).toBe(
            "PERMISSION_DENIED"
          );
        } else {
          expect(await deleteOrgVisible(session.page)).toBe(false);
          await expect(
            session.page.getByRole("tab", { name: "Members" })
          ).toHaveCount(0);

          const invite = await session.page.request.post(
            `${api}/api/organization/invitations`,
            {
              headers: { authorization },
              data: { email: "e2e-probe@example.invalid", role: "member" },
            }
          );
          expect(
            invite.status(),
            "member POST /api/organization/invitations"
          ).toBe(403);
          expect(((await invite.json()) as { code: string }).code).toBe(
            "PERMISSION_DENIED"
          );
        }

        expect(session.consoleErrors, `${role}'s console errors`).toEqual([]);
      } finally {
        await session.context.close();
      }
    });
  }

  expect(ownerConsole, "owner's console errors").toEqual([]);
});

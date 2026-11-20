# member-management-toolpack — Smoke Suite

Manual smoke test for [#847](https://github.com/EnterpriseBT/portal-ai/issues/847).
- **What shipped:** a Members tool pack on every plan, which lets the assistant invite, show, list and revoke invitations, remove members, set roles and report seats.
- **How invitations show:** as a block whose "Get invite link" button opens the fresh link in a dialog.
- **Where it's attached:** Administrate attaches the pack.

**Branch under test:** `feat/847-member-management-toolpack` (PR [#1099](https://github.com/EnterpriseBT/portal-ai/pull/1099)).

Run **§Preflight** once; after that the sections are independent.
- **Untagged steps** are browser steps `/smoke-walk` can drive.
- **`— backend`** steps are DB reads or CLI commands.
- **`— manual`** steps need a human.

## Preflight

### Environment

- [ ] `git checkout feat/847-member-management-toolpack && git pull --ff-only`
- [ ] `npm install && npm run build --workspace @portalai/core`. Core's registry and contracts changed. There's **no migration**.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`). Restart the API after the core build: nodemon watches `apps/api/src` only.

### Fixtures

| Alias | What |
|---|---|
| **qa** | `qa@portalsai.io`, the e2e owner, signed in through the e2e storageState. |
| **member** | The e2e member identity (`E2E_AUTH0_USERNAME_MEMBER` in `packages/e2e/.env`), signed in with `npm run --workspace @portalai/e2e e2e:use member`, then a restart of the MCP session. |
| **Smoke org** | "Smoke 847", created for this walk: `npx portalai org create --name "Smoke 847" --owner-email qa@portalsai.io --env local --yes --json`. Its Administrate station is provisioned with this branch's pack list. Leave it on **standard**, which shows the pack works without a paid plan. Switch qa into it with `npx portalai member switch <orgId> qa@portalsai.io --env local --yes`. — backend |

Each portal step below opens a new portal on the Smoke org's **Administrate** station and asks the quoted prompt.

### Reset between runs

- [ ] Delete the Smoke org (`npx portalai org delete <id> --env local --yes`), and switch qa back to its original org. — backend

## §1 — Administrate and the pack (slices 2, 4)

- [ ] Open Stations → **Administrate**. Its tool packs are **Access & Roles**, **Members** and **Help**, with Members active (not greyed out) on standard. Its description starts "Manage members and access through the assistant".
- [ ] Open Help → Glossary → **Tool Pack**. The built-in list includes "members (invitations, removals, roles and seats)". Open FAQ → "What are tool packs?": it ends "every plan includes Help and Members."

## §2 — Inviting through the assistant (slices 2, 3)

- [ ] Ask *"Invite alice@example.com as a member."*
  - The reply shows an **invitation block**: a region named "Invitation: alice@example.com", with a "Member" chip, "Invitation pending · expires <date>" and a **Get invite link** button.
  - No link appears anywhere in the conversation.
- [ ] Click **Get invite link**.
  - A dialog titled "Invite link for alice@example.com" opens, with focus on **Copy**.
  - The dialog shows "Invitation link — copy and share it now", a read-only "Invite link" field (`…/invitations/accept?token=…`), and **Done**.
- [ ] Click **Copy**. A "Link copied" toast appears. Click **Done**: the dialog closes, and the link is gone from the page.
- [ ] Settings → Members lists **alice@example.com** under pending invitations, as role member. The seat count went up by one.
- [ ] Reload the portal. The invitation block renders again from history, **without** a link, and its button still opens a fresh one.
- [ ] **The link isn't stored.** No assistant message for this portal contains a token: `select count(*) from portal_messages where portal_id='<id>' and blocks::text ~ 'token='` returns 0. — backend

## §3 — Refusals the same as Settings (slice 2)

- [ ] Ask *"Invite alice@example.com as a member."* again.
  - No second invitation is created.
  - The assistant says one is already pending, and shows it with an invitation block (`invitation_show`) instead of inviting again.
- [ ] Ask *"Invite qa@portalsai.io as an admin."* The assistant relays that they're already a member, and nothing is created.
- [ ] Ask *"Remove qa@portalsai.io from the organization."* qa is the only owner. The assistant relays that the last owner can't be removed, and qa is still a member.
- [ ] Ask *"How many seats are we using?"* The numbers match Settings → Members' seat count.

## §4 — Show, revoke, remove and roles (slice 2)

- [ ] Ask *"Show me the pending invitation for alice@example.com."* An invitation block for alice appears. Its **Get invite link** opens a new link, and the dialog's link differs from §2's.
- [ ] Ask *"Revoke the invitation for alice@example.com."* The assistant confirms. Settings → Members no longer lists it as pending.
- [ ] On the reloaded §2 portal, click alice's block's **Get invite link**. An error toast names the reason, the invitation is no longer pending, and no dialog opens.
- [ ] Add the member identity to the Smoke org (`npx portalai member add <orgId> <member email> --env local --yes`). Then ask *"Make <member email> an admin."*
  - Settings → Members shows them as admin.
  - Their roles were replaced as one set, keeping a system role.

  — backend for the add
- [ ] Ask *"Remove <member email> from the organization."* They disappear from Settings → Members, and the seat count drops.

## §5 — Without permission (slice 2)

- [ ] Re-add the member identity (as in §4), and sign in as **member** in the Smoke org. — backend
- [ ] On Administrate, ask *"Invite bob@example.com as a member."*
  - The assistant relays a refusal naming the permission (inviting members). It doesn't name a role.
  - No invitation for bob exists (Settings isn't visible to a member, so check `select count(*) from invitations where email='bob@example.com'`, which is 0 — backend).
- [ ] As member, ask *"Remove qa@portalsai.io."* The assistant relays the refusal (removing members), and qa is still a member.

## §6 — The Members tab is unchanged

- [ ] As qa, open Settings → Members → **Invite member**, and invite carol@example.com. The success banner shows the same "Invitation link — copy and share it now" text, the read-only link and **Copy**, as before this branch.

## Sign-off

- [ ] Every section above verified
- [ ] <date + name> — confirmed against my own running stack

## Bug-filing template

Section: · Expected: · Got: · Repro (exact prompt / click): · Identifiers (org / station / portal / invitation ids):

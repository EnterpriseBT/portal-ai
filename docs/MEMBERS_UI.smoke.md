# MEMBERS_UI — Smoke Suite

Manual smoke test for [#585](https://github.com/EnterpriseBT/portal-ai/issues/585) — the apps/web Members/Team UI over the #584 seats backend: an owner/admin-only Settings **Members** tab (member list + re-role/remove + seat usage), a **invite dialog** with a one-time copyable link, a **pending-invitations** section (resend/revoke), and an **accept landing route** with Auth0 `returnTo` login survival. **Branch under test:** `feat/members-ui` (PR [#603](https://github.com/EnterpriseBT/portal-ai/pull/603) → `epic/security-readiness`).

## Preflight

### Environment

- [ ] `git checkout feat/members-ui && git pull --ff-only`
- [ ] `npm install`
- [ ] `cd apps/api && npm run db:migrate` — applies #584's `invitations` table migration (this branch builds on it; `npm run dev` seeds but does **not** migrate). No #585-specific migration.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [ ] Signed in as an **owner** of a seeded org (local dev login `bbgrabbag@gmail.com` — the seeded org's owner).
- [ ] A **second identity** for the accept round trip: `benjamin.turner@claritysecurity.com` (used in the #584 smoke). #584 left this address as an accepted **member** of the org — for the accept walkthrough either remove it first from the Members tab (so it can be re-invited) or invite a different unused address you control.
- [ ] Note the org's tier seat cap: the seeded/base tier's `maxSeats` (e.g. `3`) — needed to test the cap-reached block. `portalops tier ...` or `db:studio` → `tiers.maxSeats` shows it; `null` = unlimited (skip the cap step or set a capped tier).

### Reset between runs

- [ ] Invites/members persist. To re-run: revoke pending invites + remove test members from the Members tab, or `db:studio` → delete rows from `invitations` / soft-deleted `organization_users`. The seeded owner is never removable (last-owner guard).

## §1 — Members tab visibility & gating (AC-1)

- [ ] As **owner/admin**, open `/settings` → a **Members** tab is present (between existing tabs and the owner-only Activity tab).
- [ ] Deep-link `/settings?tab=members` → the Members tab is selected and shows the member list.
- [ ] Sign in as (or switch role to) a plain **member**: the **Members** tab is **absent** from `/settings`, and `/settings?tab=members` falls back to the default tab (does not render Members). *(role-switch is a DB/`portalai` change — tag **manual** if you can't re-auth as a member)* — manual
- [ ] Direct API call as a member is denied: `curl -s -H "Authorization: Bearer <member-token>" localhost:3001/api/organization/members` → `403` with a permission error code. — manual

## §2 — Member list, re-role, remove, seat usage (AC-2, AC-3)

- [ ] The Members tab lists each member with Name / Email / Role / Joined and an actions column.
- [ ] Seat-usage line reads **`N / M seats used`** when the tier has a cap, or **`N member(s)`** when `maxSeats` is `null`. (Cross-check `M` against the tier's `maxSeats`.)
- [ ] As **owner**: non-owner rows show a **role Select** (admin/member); the owner row shows a static **chip** (owner role is immutable). As **admin**: no role Selects appear (re-role is owner-only). — manual (admin case needs an admin caller)
- [ ] Owner changes a member admin↔member via the Select → success toast "Role updated"; the row's role updates after refetch.
- [ ] The **Remove** icon is disabled (with a tooltip) on **your own** row and on the **last owner** row; enabled on other rows.
- [ ] Remove a non-owner member → confirm dialog → "Remove" → success toast "Member removed"; the row disappears; seat-usage `used` decrements.

## §3 — Invite + pending invitations (AC-2, AC-3)

- [ ] Click **Invite member** → dialog opens with an Email field (autofocused) + Role select offering **member** and **admin** only (no owner).
- [ ] Submit an invalid email → field shows an error, `aria-invalid="true"`, and the dialog does **not** submit.
- [ ] Invite a valid new email at role `member` → dialog closes → a success **"Invitation link"** panel appears with the URL in a read-only field + **Copy** button; clicking Copy toasts "Link copied". The new email appears in the **Pending invitations** table (Email / Role / Expires).
- [ ] Seat-usage `used` increments by 1 (a pending invite reserves a seat).
- [ ] **Resend** on a pending row → toast "New invite link generated" + a fresh link panel (the URL differs from the previous one — the old token is rotated).
- [ ] **Revoke** on a pending row → toast "Invitation revoked"; the row disappears; seat-usage `used` decrements.
- [ ] **Cap block:** with `used == maxSeats`, the **Invite member** button is **disabled** with a tooltip naming the seat limit. (If you can still open it via a stale state, submitting returns the server `409` in the dialog's alert.) — manual (requires a capped tier at exactly the cap)

## §4 — Accept flow + returnTo login survival (AC-4)

- [ ] **Logged-in accept:** copy a fresh invite link (from §3) for an address you're currently *not* signed in as won't work; instead, sign in as the **invitee** identity first, then paste the invite link → `/invitations/accept?token=…` shows a brief spinner then **"Invitation accepted / You're now a member of <org>"**, toasts, and lands on the dashboard. The invitee now appears as a member (and the org is selectable in the switcher). — manual (second identity + Auth0 login)
- [ ] **Logged-out returnTo survival:** in a fresh/incognito window (logged out), open the invite link `/invitations/accept?token=…` → you're redirected to login → sign in with Google as the invitee → after the round trip you land **back** on the accept link (not the bare dashboard) and the invitation is accepted. *(This is the `appState.returnTo` wiring — the whole point of the round trip.)* — manual (Auth0/Google redirect)
- [ ] **Idempotent re-accept:** re-open the same (now consumed) link while signed in as the invitee → shows the **"no longer valid"** (404) state, not an error crash; already a member, so no harm.

## §5 — Error & edge cases (AC-3, AC-4)

- [ ] **Expired token:** an invite past its `expiresAt` (set `invitations.expiresAt` to the past in `db:studio`, or wait out `INVITATION_TTL_DAYS`) → the pending row shows an **Expired** chip; opening its link shows **"This invitation has expired"** (410). Resend re-arms it with a fresh expiry.
- [ ] **Invalid/revoked token:** open `/invitations/accept?token=bogus` → **"This invitation link is no longer valid"** (404), with a "Go to dashboard" button.
- [ ] **Missing token:** open `/invitations/accept` (no `?token`) → **"This invitation link is incomplete"**.
- [ ] **Last-owner protection:** attempt to remove the sole owner is blocked in the UI (disabled) and, if forced via API, returns a server error. — manual (API force)

## §6 — Seat cap on the subscription surfaces (AC-3)

- [ ] Settings → **Subscription & Billing** → each plan/tier card shows a **Seats** row: Standard **Up to 5 seats**, Plus **Up to 25 seats**, Pro / Enterprise **Unlimited** (matches the catalog after `portalops tier apply`).
- [ ] Settings → **Organization** → **Subscription & Usage** section shows a **Seats** line reflecting the current org's tier cap (e.g. **Up to 5 seats** on Standard, **Unlimited** on Pro/Enterprise).

## Sign-off

- [ ] Every section above verified
- [ ] AC-5 (CI green: `lint` / `type-check` / unit + integration across api + web + core) — confirmed on PR #603's checks
- [ ] `______ (date + name)` — confirmed against my own running stack

## Acceptance-criteria → section map

| AC | Covered by |
|---|---|
| AC-1 tab visibility + server-side deny | §1 |
| AC-2 invite/copy, resend/revoke, re-role, remove, last-owner guard | §2, §3 |
| AC-3 seat usage display + cap block (409) + seat cap on billing/org cards | §2, §3, §5, §6 |
| AC-4 invitee bound + token survives login (returnTo) | §4, §5 |
| AC-5 lint/type-check/suites green | Sign-off |

## Bug-filing template

Section: · Expected: · Got: · Repro: · Identifiers (org/invitation/user ids):

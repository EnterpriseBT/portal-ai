# RBAC_ROLE_MODEL — Smoke Suite

Manual smoke test for [#576](https://github.com/EnterpriseBT/portal-ai/issues/576) — a per-user role model (`owner`/`admin`/`member`) with server-side enforcement of the three privileged actions (org delete, billing, audit-log read), a role-assignment endpoint, and role-aware Settings gating. **Branch under test:** `feat/rbac-role-model` (PR [#600](https://github.com/EnterpriseBT/portal-ai/pull/600), base `epic/security-readiness`).

Most of RBAC is server-side and needs more than one role, so this suite is **mostly manual** (DB inspection + `curl` across roles). The one browser-walkable slice is the owner-default Settings view; role-flipped views need a DB tweak between checks. Steps that a browser can drive are marked **[walk]** (`/smoke-walk`-eligible); the rest are **[manual]**.

## Preflight

### Environment

- [ ] `git checkout feat/rbac-role-model && git pull --ff-only`
- [ ] `npm install`
- [ ] **Migration required:** `cd apps/api && npm run db:migrate` — applies `0095_add_organization_user_role` (adds `organization_users.role` + CHECK + owner backfill). A freshly-merged migration 500s the consuming feature until applied.
- [ ] `npm run dev` boots cleanly (API :3001, web :3000)

### Fixtures

- [ ] Your dev login user (`bbgrabbag@gmail.com`) is the **owner** of its org — after migrate, its `organization_users.role` is `owner` (backfilled from `organizations.owner_user_id`).
- [ ] A **second member** in the same org for the role-assignment steps: `npx portalai member add --env local --org <orgId> --user <email> --yes` (or insert a membership via `db:studio`). Note its internal `user_id`.
- [ ] A bearer token for `curl` — copy the `Authorization` header from a logged-in browser request (DevTools → Network → any `/api/*` call).

### Reset between runs

- [ ] Role checks flip **your own** membership `organization_users.role` via `cd apps/api && npm run db:studio`. **Always restore it to `owner` when done** — the app's current-org resolver and your other testing depend on it.

## §1 — Migration & backfill *(AC: backfill; no lockout)* — [manual]

- [ ] After `db:migrate`, open `db:studio` → `organization_users`: your owner membership row shows `role = 'owner'`; any other membership shows `role = 'member'`; **no row has a null role**.
- [ ] `organizations.owner_user_id` for your org equals the `user_id` of the `owner` membership (the backfill keyed on this).
- [ ] Sanity: attempt a raw `role = 'viewer'` insert in `db:studio` → rejected by `organization_users_role_check`.

## §2 — Role-aware Settings gating *(AC: current() role → useRole; Activity owner+admin; danger-zone owner-only)*

- [ ] **[walk]** As **owner** (default): open **Settings**. Tabs are Profile · Organization · Subscription & Billing · **Activity**. The Activity tab is **present**.
- [ ] **[walk]** Settings → Organization → **Danger zone**: the **Delete organization** button is **enabled**.
- [ ] **[walk]** Settings → Subscription & Billing: owner-only actions (Subscribe / Manage) are **enabled**.
- [ ] **[manual]** Flip your `role` to `admin` in `db:studio`, reload Settings: **Activity tab still present** (admin may read the audit log); **Delete organization is disabled**; billing owner-actions **disabled**.
- [ ] **[manual]** Flip your `role` to `member`, reload: **Activity tab absent**; deep-linking `/settings?tab=activity` falls back to the Profile tab; Delete disabled.
- [ ] **[manual]** Restore your `role` to `owner`.

## §3 — Server-side enforcement (the real gate) *(AC: member denied privileged actions; admin all-but-billing/org-delete; owner full)* — [manual]

Run each `curl` with your bearer token; flip your `role` in `db:studio` to play each part.

- [ ] As **member**: `curl -X DELETE localhost:3001/api/organization/<orgId> -H "Authorization: Bearer <t>" -H 'content-type: application/json' -d '{"confirmationName":"<orgName>"}'` → **403 `ORGANIZATION_NOT_OWNER`**. As **admin** → also **403** (org delete is owner-only). As **owner** → proceeds (don't confirm-delete your real org; a 400 `ORGANIZATION_CONFIRMATION_MISMATCH` with a wrong name proves the owner passed the role gate).
- [ ] Audit log: `curl localhost:3001/api/organization/audit-log -H "Authorization: Bearer <t>"` → **member: 403 `AUDIT_LOG_NOT_AUTHORIZED`**; **admin: 200**; **owner: 200**.
- [ ] Billing: `curl -X POST localhost:3001/api/billing/checkout -H "Authorization: Bearer <t>" -H 'content-type: application/json' -d '{"tier":"pro"}'` → **member: 403 `BILLING_NOT_OWNER`**; **admin: 403 `BILLING_NOT_OWNER`** (billing is owner-only); **owner:** passes the gate (503/404/redirect depending on Stripe config).

## §4 — Role-assignment endpoint *(AC: only owner mints/removes admin; owner immutable; role changes audited)* — [manual]

`PATCH localhost:3001/api/organization/members/<targetUserId>/role` with `{"role":"..."}`.

- [ ] As **owner**, set the second member → `admin`: **200**; `db:studio` shows their `role = 'admin'`, **and** a new `audit_log` row `action = 'member.role.change'`, `target_id = <targetUserId>`, `metadata = { from: "member", to: "admin" }`.
- [ ] As **admin** (flip your role), try to set another member → `admin`: **403 `INSUFFICIENT_ROLE`** (only the owner mints admins).
- [ ] As **owner**, set any member → `owner`: **403 `INSUFFICIENT_ROLE`** (owner role is immutable here — ownership transfer is out of scope).
- [ ] As **owner**, target a non-member id: **404 `ORGANIZATION_USER_NOT_FOUND`**.
- [ ] As **owner**, send `{"role":"superuser"}`: **400 `ORGANIZATION_INVALID_PAYLOAD`**.
- [ ] Restore your role + the second member's role to their originals.

## §5 — Standardized RBAC-denial message *(AC: uniform denial copy)* — [manual]

The #576 UI hides/disables the owner-gated affordances, so a denial rarely surfaces in-browser (this is by design; the unit test `FormAlert.test.tsx` pins the rendering). To see it live:

- [ ] As a **member**, force a denied mutation (e.g. via DevTools re-enable the disabled **Delete organization** button and submit, or replay the billing checkout call from the console). The dialog's `FormAlert` shows the standardized lead **"You don't have permission to perform this action."** with the server's specific reason + code (e.g. `BILLING_NOT_OWNER`) as caption — not the raw server message alone.

## §6 — `current()` role on the wire *(AC: role rides the response)* — [manual]

- [ ] `curl localhost:3001/api/organization/current -H "Authorization: Bearer <t>"` → `payload.role` is present and matches your membership role (`owner` in the default fixture).

## Sign-off

- [ ] §1–§6 verified against my own running stack
- [ ] Dormant `authorization.middleware.ts` removal is verified by CI (build/type-check/lint), not this walk
- [ ] ______ (date + name) — confirmed

## Bug-filing template

Section: · Expected: · Got: · Repro (role + request): · Identifiers (org/user/audit ids):

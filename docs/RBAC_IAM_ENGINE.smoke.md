# rbac-iam-engine — Smoke Suite

Manual smoke test for [#598](https://github.com/EnterpriseBT/portal-ai/issues/598) — the data-driven RBAC engine + system policies that replace #576's hardcoded role switch. **Branch under test:** `feat/598-rbac-iam-engine` (PR [#619](https://github.com/EnterpriseBT/portal-ai/pull/619)).

**This ticket is backend-only and behavior-preserving** — no UI, no API-shape change. There is **no browser walk** (`/smoke-walk` is N/A); every step is a DB / CLI / API check against your dev stack. The substantive proof is the suites (2782 unit + 1598 integration, incl. switch-parity); this walk confirms the live migration + provisioning + no regression. All steps are **manual**.

## Preflight

### Environment

- [ ] `git checkout feat/598-rbac-iam-engine && git pull --ff-only` — manual
- [ ] `npm install` — manual
- [ ] **Migrate** (this branch ships two): `cd apps/api && npm run db:migrate` — applies `0101_add_rbac_engine` (4 tables) then `0102_backfill-rbac-system-policies` (seeds every existing local org). Completes with no error. — manual
- [ ] `npm run dev` boots cleanly (API :3001, web :3000). — manual

### Fixtures

- [ ] Your seeded local dev org + login (`bbgrabbag@gmail.com`). The 0102 backfill should have seeded RBAC onto it since it predates this branch. — manual

### Reset between runs

- [ ] Read-only inspection + idempotent re-runs; no reset needed. (Re-running `db:migrate` is a no-op — migrations are tracked; `seedRbacSystemPolicies` early-returns when the owner role exists.) — manual

## §1 — Provisioning: existing org backfilled + new org seeded (slice 2)

- [ ] **Existing org backfilled.** In `npm run db:studio` (or psql), for your dev org's `organization_id`: `roles` has `owner`/`admin`/`member` (kind `system`); `permission_policies` has `FullAccess`/`AdminAccess`/`MemberAccess`; `permission_statements` has **28 rows** for it (FullAccess 1 + AdminAccess 3 + MemberAccess 24); `policy_attachments` has 3 (`role` principal → each policy). — manual
- [ ] **New org seeded at provisioning.** Provision a fresh org (`portalai org provision …` per `packages/admin-cli/COMMANDS.md`, or the app's create-org path) and confirm the same 3 roles / 3 policies / 28 statements / 3 attachments appear for its `organization_id`. — manual

## §2 — Guard parity: privileged actions behave exactly as #576 (slices 3–4)

*The engine now computes these from the seeded policies; behavior must be identical to before. (Admin/member parity is exhaustively covered by the suites; live-check what your dev identity can exercise.)*

- [ ] **Owner is unaffected.** As the org owner, a privileged action still works — e.g. open **Settings → Billing** and start a checkout/portal (owner passes `billing.manage`); or hit an owner-only endpoint. No new 403. — manual
- [ ] **Deny still denies with the same code.** From a non-owner context (a second member, or `curl` with a member token) call an owner-only route (e.g. `POST /api/billing/checkout`) → **403 `BILLING_NOT_OWNER`** (unchanged code); a member calling `PATCH` member-role → **403 `INSUFFICIENT_ROLE`**. — manual
- [ ] **Fail-closed sanity.** (Optional) For an org with the RBAC rows deleted, an owner's privileged action is **denied** (empty policy set ⇒ fail-closed) — confirms the engine never fails open. Restore via re-provision/backfill. — manual

## §3 — No behavior change where wiring is deferred to #621

- [ ] **Member data visibility is unchanged.** As a member, the stations / pins list still returns the same rows as before this branch (the `visibilityPredicate` is built + unit-tested but **not wired into routes** in #598 — that's #621). #598 must not have tightened member list visibility. — manual
- [ ] **No API-shape change.** A spot GET (e.g. `/api/stations`, `/api/organization/current`) returns the same payload shape as `main`. — manual

## §4 — Static gates (already green in CI; re-confirm locally if desired)

- [ ] `npm run type-check` + `npm run lint` clean (dual-schema guards compile; zero warnings). — manual
- [ ] `cd apps/api && npm run db:generate` reports **no schema drift** (the migration matches the tables). — manual

## Sign-off

- [ ] §§1–4 verified against my own running stack.
- [ ] CI green on PR #619 (Unit / Integration / Static Checks).
- [ ] <date + name> — confirmed.

## Bug-filing template

Section: · Expected: · Got: · Repro (CLI/curl + role): · Identifiers (org id, role/policy/statement ids):

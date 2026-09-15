# Onboarding: first-login provisioning — Plan

**TDD-sequenced implementation: the `users.auth0_id` unique index + `findOrCreateByAuth0Id` + `withProvisioningLock`, then the shared `ensureProvisioned` (webhook delegates, `setupOrganization` folds in), then the `getApplicationMetadata` self-heal.**

Spec: `docs/ONBOARDING_PROVISIONING.spec.md`. Discovery: `docs/ONBOARDING_PROVISIONING.discovery.md`. Issue: #583 (epic #578). Builds on shipped #576 (`organization_users.role`; owner membership already `role:"owner"`).

Three slices, each behind a green suite and each leaving the tree compilable + the webhook working. They land as **commits on `feat/onboarding-provisioning`** (PR #601 → `epic/security-readiness`) — one feature, one PR.

Run tests from the api package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — foundations that carry no behavior change first, then the shared path, then the request-path wire-up:

- **Slice 1** — the idempotency primitives (unique index, on-conflict create, provisioning advisory lock). Nothing calls them yet; the webhook is untouched.
- **Slice 2** — `ensureProvisioned` composes them; the webhook delegates to it and `setupOrganization` is removed. The eager path now runs through the shared function.
- **Slice 3** — `getApplicationMetadata` self-heals on the miss, making the invariant hold on the live request path.

**One migration** (slice 1). No `apps/web` / `packages/core` changes.

---

## Slice 1 — Idempotency primitives: unique index + `findOrCreateByAuth0Id` + `withProvisioningLock`

The concurrency/idempotency foundations, unreferenced by any live path yet.

**Files**

- Edit: `apps/api/src/db/schema/users.table.ts` — partial unique index `users_auth0_id_unique` on `auth0_id` `WHERE deleted IS NULL`.
- New: the migration (`npm run db:generate -- --name add_users_auth0_id_unique_index`) — index only, no data step (OQ1).
- Edit: `apps/api/src/db/repositories/users.repository.ts` — `findOrCreateByAuth0Id(data) → { user, created }` (insert-`onConflictDoNothing({target: users.auth0Id})`-returning → else `findByAuth0Id`).
- Edit: `apps/api/src/services/sync-lock.service.ts` — `PROVISION_LOCK_NAMESPACE` + `withProvisioningLock<T>(auth0Sub, fn)` (waiting, its own namespace).
- Tests: `apps/api/src/__tests__/__integration__/db/repositories/users.repository.integration.test.ts` (cases 1–2); a `withProvisioningLock` integration test (case 3).

**Steps**

1. **Tests (spec cases 1–3).** `findOrCreateByAuth0Id`: new → `{created:true}`; repeat same `auth0Id` → `{created:false}`, same row, no duplicate. Unique index rejects a raw duplicate live `auth0_id`; a soft-deleted row doesn't block a new insert. `withProvisioningLock`: two concurrent holders on one sub run `fn` serially (second waits, sees the first's effect). Run; fail.
2. **Implement** the index + migration, the repo method, the lock method. Green.
3. Lint + type-check. Commit the migration `.sql` + `meta/_journal.json` + snapshot together (`project_drizzle_journal_must_be_committed`).

**Done when:** cases 1–3 pass; nothing live calls the new code yet; the webhook is unchanged.

**Risk:** the on-conflict target must match the new index name/columns; a soft-deleted collision is out of scope (none exist, OQ1).

---

## Slice 2 — `ensureProvisioned` + webhook delegation + remove `setupOrganization`

The shared idempotent provisioning path. The eager (webhook) path moves onto it; `setupOrganization` folds in.

**Files**

- Edit: `apps/api/src/services/application.service.ts` — add `ensureProvisioned(auth0Sub, resolveProfile, auditCtx?)`; **remove `setupOrganization`** (its create-user+provision role is subsumed). Keep `provisionOrganizationInTx` / `provisionOrganizationFor` as the reusable core (the future in-UI "create org" reuses `provisionOrganizationFor`, KD5).
- Edit: `apps/api/src/services/webhook.service.ts` — new-user branch delegates to `ensureProvisioned` (lazy profile from the payload; audit ctx from `ip`/`user_agent`). Existing-user branch unchanged.
- Edit: test callers of `setupOrganization` → migrate to `ensureProvisioned` (new-user) or `provisionOrganizationFor` (existing-user). Known sites: `organization.router.audit-log.integration.test.ts` (uses `ApplicationService.setupOrganization(createOwner())`) and any `__integration__/utils` helper; grep-confirm the full set.
- Tests: `apps/api/src/__tests__/__integration__/services/ensure-provisioned.integration.test.ts` (cases 4–8); webhook cases (14–15) extend/adjust the existing webhook integration test.

**Steps**

1. **Tests (spec cases 4–8, 14–15).** `ensureProvisioned`: new sub → user+org+**owner** membership, `resolveProfile` called once, `created:true`; existing user w/ membership → no-op, `resolveProfile` **not** called, no new org; existing user w/ zero memberships → provisions; **concurrency** — two parallel calls for a new sub → exactly one user+one org; audit rows emitted only on provision. Webhook: new user → provisioned via `ensureProvisioned`; re-delivery → no duplicate. Run; fail.
2. **Implement** `ensureProvisioned` (find-or-create user via slice-1 method; `withProvisioningLock(sub, …)` → re-check `getCurrentOrganization` → `provisionOrganizationInTx` in a txn → audit on create). Delegate the webhook. Delete `setupOrganization` and migrate its test callers. Green.
3. Lint + type-check.

**Done when:** cases 4–8 + 14–15 pass; the webhook provisions through `ensureProvisioned`; `setupOrganization` is gone with no dangling references; concurrency proven (index + lock together).

**Risk:** removing `setupOrganization` breaks its test callers — migrate them in this slice (type-check catches any missed reference). The lock wraps a transaction — follow the `SyncLockService` reserved-connection pattern (#460); the re-check inside the lock is what makes it a true no-op for the loser.

---

## Slice 3 — `getApplicationMetadata` self-heal

The request-path wire-up that makes the invariant hold regardless of the webhook.

**Files**

- Edit: `apps/api/src/middleware/metadata.middleware.ts` — on `findByAuth0Id` empty **or** `getCurrentOrganization` empty, call `ensureProvisioned(sub, resolveProfile, auditCtx)` where `resolveProfile` fetches the Auth0 profile via `Auth0Service.getAuth0UserProfile(Auth0Service.getAccessToken(req.headers.authorization))`; attach `{userId, organizationId, role}` from the result. Auth0 fetch failure → 500 `METADATA_FETCH_FAILED` (fail-closed).
- Tests: `apps/api/src/__tests__/middleware/metadata.middleware.test.ts` (cases 9–13) — extend the existing test (mock `Auth0Service` + `ApplicationService.ensureProvisioned`).

**Steps**

1. **Tests (spec cases 9–13).** no user → provisions (Auth0 mocked), attaches `{…, role:"owner"}`, proceeds (not 404); user w/o membership → provisions, proceeds; happy path → `ensureProvisioned` **not** called (spy), unchanged; Auth0 fetch throws → 500 `METADATA_FETCH_FAILED`, no partial user; missing `sub` → 401 `METADATA_MISSING_AUTH`. Run; fail.
2. **Implement** the self-heal branch. Green.
3. Lint + type-check.

**Done when:** cases 9–13 pass; a brand-new authed user reaches metadata-gated routes without the webhook; the happy path incurs no extra work.

**Risk:** coupling the middleware to `Auth0Service` on the miss path — bounded to first-login (rare); happy path untouched (case 11 asserts no call).

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | unique index + `findOrCreateByAuth0Id` + `withProvisioningLock` | 1–3 | api integration |
| 2 | `ensureProvisioned` + webhook delegation + remove `setupOrganization` | 4–8, 14–15 | api integration |
| 3 | `getApplicationMetadata` self-heal | 9–13 | api unit (middleware) |

Total ≈ **15 cases**. One migration (slice 1). Commits on `feat/onboarding-provisioning` → PR #601.

## Cross-slice notes

- **Provisioning core stays reusable (KD5).** `provisionOrganizationInTx` / `provisionOrganizationFor` remain the single core; `ensureProvisioned` (first-login, no-membership gate) and the **future in-UI "create a new org"** route (an authed user adding another owned org — reuses `provisionOrganizationFor`, *bypassing* the no-membership gate) are two entry points onto it. Don't let `ensureProvisioned`'s gate leak into the core.
- **`setupOrganization` removal is deliberate**, not incidental — it had no non-test caller once the webhook moves (slice 2). Tests migrate to `ensureProvisioned` / `provisionOrganizationFor`; no compatibility shim kept for tests' sake (`feedback_no_compat_aliases`).
- **Concurrency correctness** is the point: the unique index (slice 1) is the hard backstop, `withProvisioningLock` (slice 1) serializes the check-then-provision, and slice-2 case 7 asserts them together (parallel `ensureProvisioned` → one user+org).
- **Migration hygiene:** commit `.sql` + journal + snapshot together; after merge run `cd apps/api && npm run db:migrate` on any dev DB (`project_dev_seeds_not_migrates`).
- **Audit parity:** `ensureProvisioned` owns the `org.create` + `auth.login{firstLogin}` emission, so webhook and request path audit identically — the emission moves out of `webhook.service.ts` into the shared function.
- **Fail-closed** on Auth0 fetch failure (slice 3) — a first-login that can't reach Auth0 is denied (500, retriable), never a nameless partial user.
- **Webhook keeps working every slice** — slice 1 adds unused primitives, slice 2 swaps its internals, slice 3 doesn't touch it.
- **Docs-in-sync:** no user-facing doc or `CLAUDE.md` convention changes (internal provisioning path); the phase docs are the record.

## Next step

Implement slice 1 first (tests-first), one commit per slice — only after discovery + spec + plan are reviewed and confirmed. Each slice green and independent; the webhook stays functional throughout, and the request-path invariant lands in slice 3.

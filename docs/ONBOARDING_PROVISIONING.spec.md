# Onboarding: first-login provisioning — Spec

**Issue:** [EnterpriseBT/portal-ai#583](https://github.com/EnterpriseBT/portal-ai/issues/583) · **Epic:** #578 · **Discovery:** `docs/ONBOARDING_PROVISIONING.discovery.md`

Pins the contract for #583: one idempotent, concurrency-safe `ApplicationService.ensureProvisioned` shared by the Auth0 webhook and a new **self-heal in `getApplicationMetadata`**, a `users.auth0_id` unique index + advisory lock as the idempotency guard, so every authenticated user resolves to ≥1 membership with a role on the **live request path** — independent of whether the Auth0 post-login Action ever fired.

## Key decisions (from resolved discovery OQs)

1. **Self-heal in `getApplicationMetadata`** (D1/OQ3) — provision on the miss branch, not a dedicated bootstrap route.
2. **Idempotency = partial unique index on `users.auth0_id WHERE deleted IS NULL` + advisory lock** (D2/OQ1). No dedupe migration — zero collisions in any environment (confirmed).
3. **Profile on the miss = fetch from Auth0** via the request's access token (D3); **fail-closed (500)** if the fetch fails (OQ4) — never provision a nameless user.
4. **Invited users are #584's concern** (OQ2): an invited user will join the invited org **only**. #583 provisions a personal owner-org for a genuinely new user and shapes `ensureProvisioned` so #584 can insert the invite branch before personal-org creation.
5. **Fold in `setupOrganization`; keep the provisioning core reusable.** `ensureProvisioned` is the *first-login* wrapper (find-or-create user + provision **iff no membership**). The reusable provisioning core stays the separate `provisionOrganizationInTx` / `provisionOrganizationFor(userId, {name})` — which a **future in-UI "create a new org" feature** calls directly for an already-provisioned user adding another org they own (it must *not* route through `ensureProvisioned`'s no-membership gate). So `ensureProvisioned` and `provisionOrganizationFor` are two entry points onto one core; `setupOrganization` (create-user+provision, webhook-only) collapses into `ensureProvisioned`.

## Scope

### In scope
1. `users.auth0_id` partial unique index (migration).
2. `UsersRepository.findOrCreateByAuth0Id` — insert-on-conflict-do-nothing → re-read.
3. `SyncLockService.withProvisioningLock` — a waiting advisory lock in its own namespace.
4. `ApplicationService.ensureProvisioned(auth0Sub, resolveProfile)` — find-or-create user + advisory-locked provision-if-no-membership + audit.
5. `WebhookService.syncUser` — create branch delegates to `ensureProvisioned`.
6. `getApplicationMetadata` — self-heal on `METADATA_USER_NOT_FOUND` / `METADATA_ORGANIZATION_NOT_FOUND`.

### Out of scope
- Invitations / joining an existing org, seat caps — #584. Members UI — #585. SSO on-first-token — #577 (reuses `ensureProvisioned`).
- Removing the Auth0 webhook (kept as the eager path).

## Surface

### Migration — `users.auth0_id` unique index

**File: `apps/api/src/db/schema/users.table.ts`** — add a partial unique index:

```ts
(t) => [
  uniqueIndex("users_auth0_id_unique").on(t.auth0Id).where(sql`${t.deleted} IS NULL`),
]
```

Drizzle-generated migration only (no data step — OQ1). This index is also the `onConflictDoNothing` target below.

### `UsersRepository.findOrCreateByAuth0Id`

**File: `apps/api/src/db/repositories/users.repository.ts`** — add:

```ts
/** Idempotent create: insert, or return the existing live row on auth0_id
 *  conflict. The unique partial index is the conflict target. */
async findOrCreateByAuth0Id(
  data: UserInsert,
  client: DbClient = db,
): Promise<{ user: UserSelect; created: boolean }>
```

Behavior: `insert(users).values(data).onConflictDoNothing({ target: users.auth0Id }).returning()`. A returned row → `{ user, created: true }`; empty (conflict) → `findByAuth0Id(data.auth0Id)` → `{ user, created: false }`. (The `.notDeleted()` finder handles the live-row case; a soft-deleted collision is out of scope — none exist.)

### `SyncLockService.withProvisioningLock`

**File: `apps/api/src/services/sync-lock.service.ts`** — add a sibling to `withInstanceLockWait`, in a **distinct namespace** (the file already guards against keyspace collisions):

```ts
const PROVISION_LOCK_NAMESPACE = 0x50_52_56_4e; // "PRVN"
/** Wait-acquire an advisory lock keyed on an Auth0 sub for first-login
 *  provisioning; always runs `fn` (throws on timeout, like withInstanceLockWait). */
static async withProvisioningLock<T>(auth0Sub: string, fn: () => Promise<T>): Promise<T>
```

Waiting (not the non-blocking `withInstanceLock`) — a first-login must complete, and the loser of a race must wait, then observe the now-provisioned membership and no-op.

### `ApplicationService.ensureProvisioned`

**File: `apps/api/src/services/application.service.ts`** — the shared idempotent path:

```ts
static async ensureProvisioned(
  auth0Sub: string,
  resolveProfile: () => Promise<{ email: string | null; name: string | null; picture: string | null }>,
  auditCtx?: { sourceIp: string | null; userAgent: string | null },
): Promise<{ user: UserSelect; organization: OrganizationSelect; organizationUser: OrganizationUserSelect; created: boolean }>
```

Behavior:
1. **User:** `findByAuth0Id(sub)`; if absent, `resolveProfile()` then `findOrCreateByAuth0Id({ auth0Id, email, name, picture, lastLogin })` (lazy — the Auth0 fetch runs only when a create is needed).
2. **Org (locked):** inside `withProvisioningLock(sub, …)`, re-check `getCurrentOrganization(user.id)`; if a live membership exists → return it (`created: false`, idempotent no-op). Else `DbService.transaction(tx => provisionOrganizationInTx(user.id, tx))` → `{ organization, organizationUser }` (`created: true`).
3. **Audit** (only when a membership was just created): emit `org.create` + `auth.login {firstLogin:true}` (post-commit, fail-open) with `auditCtx`. Lifted from `webhook.service.ts:58-74`.

`provisionOrganizationInTx` already sets the owner membership `role:"owner"` (`application.service.ts:304`) — unchanged.

### `WebhookService.syncUser` — delegate the create branch

**File: `apps/api/src/services/webhook.service.ts:29-77`** — replace the bespoke `UserModelFactory` + `setupOrganization` + audit block with:

```ts
if (!existing) {
  const { user } = await ApplicationService.ensureProvisioned(
    payload.user_id,
    async () => ({ email: payload.email ?? null, name: payload.name ?? null, picture: payload.picture ?? null }),
    { sourceIp: payload.ip ?? null, userAgent: payload.user_agent ?? null },
  );
  return { action: "created", userId: user.id };
}
```

The existing-user branch (profile/`lastLogin` update + login audit) is unchanged. **`setupOrganization` is removed** (KD5): once the webhook moves to `ensureProvisioned`, it has no non-test caller, and its create-user+provision role is exactly what `ensureProvisioned` does. Tests that used it migrate to `ensureProvisioned` (new-user path) or `provisionOrganizationFor` (existing-user path).

### `getApplicationMetadata` — self-heal

**File: `apps/api/src/middleware/metadata.middleware.ts:34-50`** — on either miss, provision then re-resolve:

- `users.findByAuth0Id(sub)` empty **or** `getCurrentOrganization(user.id)` empty → call `ensureProvisioned(sub, resolveProfile, auditCtx)` where `resolveProfile = () => Auth0Service.getAuth0UserProfile(Auth0Service.getAccessToken(req.headers.authorization))` mapped to `{email,name,picture}`, and `auditCtx` from `req.ip` / `req.get("user-agent")`.
- Then attach `{ userId, organizationId, role }` from the ensured result (no second query needed — `ensureProvisioned` returns them).
- **Auth0 fetch failure → 500 `METADATA_FETCH_FAILED`** (fail-closed, OQ4). Keep `METADATA_MISSING_AUTH` (no `sub`) as-is.

No new `ApiCode`. `METADATA_USER_NOT_FOUND` / `METADATA_ORGANIZATION_NOT_FOUND` become effectively unreachable on the happy path (retained for the fail-closed edge where provisioning itself can't resolve).

## Migration

`cd apps/api && npm run db:generate -- --name add_users_auth0_id_unique_index` — one `CREATE UNIQUE INDEX "users_auth0_id_unique" ON users (auth0_id) WHERE deleted IS NULL`. No backfill/dedupe (OQ1). Commit `.sql` + `meta/_journal.json` + snapshot together.

## Seed

No seed change.

## TDD test plan

Run via npm scripts: `cd apps/api && npm run test:unit && npm run test:integration`.

### Layer 1 — repo + lock (api integration)
1. `findOrCreateByAuth0Id` inserts a new user → `{created:true}`; a second call same `auth0Id` → `{created:false}` returning the original (no duplicate).
2. Unique index rejects a raw duplicate live `auth0_id`; a soft-deleted row does not block a new insert (partial index).
3. `withProvisioningLock` serializes: two concurrent holders on the same sub run `fn` one-at-a-time (second waits, sees the first's effect).

### Layer 2 — `ensureProvisioned` (api integration)
4. New sub → creates user + org + **owner** membership; `resolveProfile` invoked once; returns `created:true`.
5. Existing user with a membership → **no-op**, `resolveProfile` **not** invoked, `created:false`, no new org.
6. Existing user with **zero** memberships → provisions an org (the self-heal case), `created:true`.
7. **Concurrency:** two `ensureProvisioned(sub)` in parallel for a brand-new sub → exactly one org + one user; the other observes and returns the same (no duplicate users/orgs). Asserts the index + lock together.
8. Provision path emits `org.create` + `auth.login{firstLogin}` audit rows; the no-op path emits neither.

### Layer 3 — middleware self-heal (api integration, mocked Auth0)
9. Authed request, **no user row** → middleware provisions (Auth0 profile mocked), attaches `{userId, organizationId, role:"owner"}`, request proceeds (not 404).
10. Authed request, user exists but **no membership** → provisions, proceeds.
11. Happy path (user + membership exist) → **no** `ensureProvisioned` call (spy), one `findByAuth0Id` + `getCurrentOrganization`, unchanged.
12. Auth0 profile fetch throws → **500 `METADATA_FETCH_FAILED`**, no partial user created.
13. Missing `sub` → 401 `METADATA_MISSING_AUTH` (unchanged).

### Layer 4 — webhook delegation (api integration)
14. `POST /api/webhooks/auth0/sync` new user → provisioned via `ensureProvisioned` (user+org+owner membership); `{action:"created"}`.
15. Re-delivery of the same new-user webhook → no duplicate user/org (`ensureProvisioned` idempotent); existing-user branch still updates profile + audits login.

**Totals:** ~3 repo/lock, ~5 `ensureProvisioned`, ~5 middleware, ~2 webhook ≈ **15 cases**. Migration verified by the index-rejection case (2) on the migrated test DB; no separate migration test.

## Acceptance criteria

- [ ] A brand-new authenticated user hitting any metadata-gated route ends up with user + org + owner membership **without** the Auth0 webhook firing; the request succeeds.
- [ ] Re-login and **concurrent** first-logins produce exactly one user + one org (no duplicates) — proven under parallel `ensureProvisioned` and the unique index.
- [ ] Webhook and request path both provision via `ensureProvisioned` and emit identical audit rows.
- [ ] Auth0 profile fetch failure on the miss path fails **closed** (500), leaving no partial user.
- [ ] Happy-path requests incur no extra provisioning work; `npm run lint && npm run type-check` clean.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Concurrent first-logins duplicate user/org. | Unique index (hard) + `withProvisioningLock` around check-then-provision; case 7 asserts it. |
| Adding the unique index fails on existing dupes. | None exist in any environment (OQ1, confirmed); index is plain. If a dupe ever appears, migrate fails loudly at deploy — not silently. |
| Auth0 fetch on every request (perf). | Fetch only on the **miss** branch (first login) — happy path unchanged (case 11). |
| Self-heal masks a genuinely broken auth. | Fail-closed on fetch failure (500), not a nameless provision (case 12). |
| `resolveCallerOrg` (billing) still 404s for an unprovisioned user. | Acceptable — the SPA always hits a metadata-gated route before billing; noted in discovery. |

**Rollback:** revert the migration (drop the index) + `git revert`. `ensureProvisioned` is additive; reverting restores the webhook-only path.

## Files touched

**`apps/api`** — new: the migration, `services/__tests__`/`__integration__` cases. Edit: `db/schema/users.table.ts`, `db/repositories/users.repository.ts`, `services/sync-lock.service.ts`, `services/application.service.ts`, `services/webhook.service.ts`, `middleware/metadata.middleware.ts`. No `apps/web` or `packages/core` changes.

## Next step

`docs/ONBOARDING_PROVISIONING.plan.md` — TDD slices on this branch: (1) unique-index migration + `findOrCreateByAuth0Id` + `withProvisioningLock`; (2) `ensureProvisioned` (find-or-create + locked provision-if-no-membership + audit) + webhook delegation; (3) `getApplicationMetadata` self-heal (Auth0 fetch, fail-closed). ~3 slices, each green; the webhook keeps working throughout.

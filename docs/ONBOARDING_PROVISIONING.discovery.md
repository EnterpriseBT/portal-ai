# Onboarding: first-login provisioning — Discovery

**Issue:** [EnterpriseBT/portal-ai#583](https://github.com/EnterpriseBT/portal-ai/issues/583) · part of the Security & Enterprise Readiness epic ([#578](https://github.com/EnterpriseBT/portal-ai/issues/578))

**Why this exists.** Every authenticated user must reliably resolve to a `user` row + an org + a membership carrying a role — RBAC (#576) and seats (#584/#585) are meaningless otherwise. The ticket frames `ApplicationService.setupOrganization` as "test-only," but the survey shows it is actually wired to the **Auth0 post-login webhook** (`WebhookService.syncUser`). The real gap is narrower and sharper: **the JWT request path has no provisioning at all.** If Auth0's post-login Action never fires (misconfigured, unreachable, or a user that predates it), the user hits `getApplicationMetadata` and is **locked out** with a 404 — and even past that, `PermissionService` is fail-closed on a missing role. This is the ticket that makes first-login provisioning a guaranteed invariant on the **live request path**, idempotently, reconciled with the webhook.

## The current shape

### Provisioning core

| Piece | Location | What it does |
|---|---|---|
| `setupOrganization(owner)` | `application.service.ts:126` | Txn: `users.create(owner)` → `provisionOrganizationInTx`. The **only** create-user path. Called from the webhook (`webhook.service.ts:40`) — **not** from any JWT route. |
| `provisionOrganizationInTx(userId, tx, opts)` | `application.service.ts:280` | Shared body: creates org (`ownerUserId = userId`), the **owner membership** (`role: "owner"`, `:304`), then `provisionOrganizationWorkspace` (`:339`) — system columns, Sandbox instance, "My Station", `data_query` toolpack, station link, `defaultStationId`. Does **not** create the user. |
| CLI seams | `application.service.ts:147/157/168` | `provisionOrganizationFor` (existing user), `createOrganizationForEmail`, `seedOrganization` (idempotent-by-name, synthetic `seed|<uuid>` owner). CLI-only. |

### The two entry points today

- **Auth0 webhook** — `WebhookService.syncUser` (`webhook.service.ts:15`), `POST /api/webhooks/auth0/sync` (`webhook.router.ts:114`), HMAC-authed (`webhook-auth.middleware.ts`, bare-hex `X-Auth0-Webhook-Signature`). New `sub` → `setupOrganization` (user+org+owner membership); existing → profile/`lastLogin` update only. Fires only if Auth0's Action is configured/reachable.
- **JWT request path** — nothing provisions. User rows are created **only** by the webhook; `GET /api/profile` (`profile.router.ts:72`) is read-only (returns `null` when no row).

### Request-time resolution — the lockout

`getApplicationMetadata` (`metadata.middleware.ts:17`, after `jwtCheck`): `sub` missing → 401 `METADATA_MISSING_AUTH`; **`users.findByAuth0Id(sub)` empty → 404 `METADATA_USER_NOT_FOUND` (`:37`)**; `getCurrentOrganization(user.id)` (`application.service.ts:25`, `last_login DESC NULLS LAST`) empty → **404 `METADATA_ORGANIZATION_NOT_FOUND` (`:46`)**. On success attaches `{ userId, organizationId, role }`. Those two 404s are exactly the failure the invariant eliminates. `PermissionService` (`permission.service.ts:122`) then fail-closes on any unresolved role.

### Idempotency & concurrency (the sharp edge)

There is **no unique constraint on `users.auth0_id`** (`users.table.ts` declares it `notNull()` only — no unique index in schema or migrations). Idempotency rests entirely on `syncUser`'s `findByAuth0Id` check. `setupOrganization` is atomic per call, but **two concurrent first-logins for the same `sub`** (webhook retry + a would-be request-time provisioner, or double delivery) both pass the existence check and both insert → **duplicate users + duplicate "My Organization" orgs**, with no DB guard to collapse the race.

### RBAC dependency (#576, merged)

`organization_users.role` is a typed enum (`ORG_ROLES`, `organization-user.model.ts:17`, `NOT NULL DEFAULT 'member'` + CHECK). The owner membership gets `role:"owner"` at `application.service.ts:304`. `PermissionService` is driven by the `(userId, orgId, role)` context the middleware resolves — so the invariant isn't cosmetic: no membership ⇒ locked out **and** denied.

## The design space

### Decision 1 — Where the live path provisions

| | A — Self-heal in `getApplicationMetadata` ✓ | B — Dedicated bootstrap route (SPA calls on login) | C — Webhook-only, make it reliable |
|---|---|---|---|
| Guarantees invariant on every authed request | Yes | Only if the SPA calls it | No (depends on Auth0 Action) |
| New surface | none (extend the miss branch) | a new route + SPA wiring | none |
| Works for users who predate the webhook | Yes | Only after they hit bootstrap | No |

**Lean: A.** On the middleware's miss branch (no user, or no membership), provision idempotently, then continue — the request self-heals, so the invariant holds regardless of whether the webhook ever fired. The happy path (user + membership exist) is unchanged: one `findByAuth0Id` + `getCurrentOrganization`, no extra cost. The webhook stays as an *eager* optimization; both call one shared function.

### Decision 2 — Idempotency & concurrency guard

| | A — unique index + advisory lock ✓ | B — advisory lock only | C — unique index only |
|---|---|---|---|
| Duplicate `users` rows | prevented (hard) | racy | prevented |
| Duplicate auto-orgs (check-then-act) | prevented (lock) | prevented | racy |

**Lean: A.** (1) A **partial unique index** on `users.auth0_id WHERE deleted IS NULL` — the hard backstop against duplicate users (no existing collisions in any environment, OQ1 — so a plain index, no dedupe). (2) A **Postgres advisory lock** keyed on the `sub`/user id around the "no live membership ⇒ provision" check-then-act, reusing the `SyncLockService.withInstanceLock` advisory-lock pattern (#460) — chosen because the guard is a check-then-act a lease/timer can't make safe. `users.create` uses insert-**on-conflict-do-nothing** then re-read, so a lost race resolves to the existing row.

### Decision 3 — Profile source when provisioning on the request path

The webhook receives the full Auth0 profile; the JWT only carries `sub` (+ maybe email/name if scoped).

| | A — fetch Auth0 profile on the miss ✓ | B — JWT claims only | C — minimal user (sub only), fill later |
|---|---|---|---|
| Complete user row (email/name/picture) | Yes | Only if scopes present | No (degraded until a sync) |
| Cost | one Auth0 call on the **rare** first-login miss | none | none |

**Lean: A.** Reuse `Auth0Service.getAuth0UserProfile` (the same call `GET /api/profile` already makes) on the miss path — first-login is rare, so the extra call is negligible, and it yields a complete user row. Fall back to JWT claims / a minimal row only if the Auth0 fetch fails (see Failure modes).

### Decision 4 — The shared provisioning contract

**Lean: extract `ApplicationService.ensureProvisioned(auth0Sub, profile)`** — find-or-create the user (on-conflict), then under the advisory lock, if the user has **zero live memberships**, run `provisionOrganizationInTx`. Idempotent + concurrency-safe. `WebhookService.syncUser` and the request-path self-heal both call it — one code path, one behavior, whichever entry fires (the ticket's "reconcile" requirement).

## Tradeoff comparison

|  | D1 self-heal | D2 index+lock | D3 profile fetch | D4 shared `ensureProvisioned` |
|---|---|---|---|---|
| Spread to spec | Yes | Yes (+ migration) | Yes | Yes |
| Lands in #583 | middleware miss branch | migration + repo on-conflict + lock util | middleware miss path | service refactor (webhook + request share it) |

## Recommendation

1. Extract **`ApplicationService.ensureProvisioned(auth0Sub, profile)`**: `users` find-or-create (insert-on-conflict-do-nothing → re-read), then advisory-lock on the sub/user id, and `provisionOrganizationInTx` only when the user has zero live memberships. Idempotent + concurrency-safe.
2. Add a **partial unique index** on `users.auth0_id WHERE deleted IS NULL` (plain index — no pre-existing collisions in any environment, OQ1).
3. **`getApplicationMetadata`**: on `METADATA_USER_NOT_FOUND` or `METADATA_ORGANIZATION_NOT_FOUND`, call `ensureProvisioned` (fetching the Auth0 profile for a new user), then re-resolve and continue — the self-heal that guarantees the invariant.
4. **`WebhookService.syncUser`** delegates its create branch to `ensureProvisioned` (keeps eager post-login provisioning; drops its bespoke create).
5. Keep `role:"owner"` on the provisioned membership (already there); the invariant now holds for `PermissionService`.

## Open questions

1. **Pre-existing `auth0_id` duplicates.** **RESOLVED — none exist in any environment** (confirmed). The migration is a plain partial unique index on `users.auth0_id WHERE deleted IS NULL`; no dedupe step.
2. **Invitation interaction (#584).** **DECIDED — an invited user joins the invited org ONLY** (no personal org). So the invariant is "≥1 membership," satisfied by *either* a personal owner-org *or* an accepted invite — not necessarily a personal org. #583 provisions the personal owner-org for a genuinely new, un-invited user and builds the seam; #584 adds the branch: on a pending invite, `ensureProvisioned` accepts the invite (joins that org) and **skips** personal-org creation. #583 must therefore shape `ensureProvisioned` as "ensure ≥1 membership" with personal-org as the only path *today* (no invite system exists yet), leaving a clean insertion point for the invite branch.
3. **Where the self-heal lives — inside `getApplicationMetadata` vs a thin middleware before it.** **DECIDED — inside `getApplicationMetadata`'s miss branch** — it already owns user→org→role resolution; a second middleware would duplicate the lookups. `resolveCallerOrg` (billing) relies on prior provisioning — acceptable, since the SPA always hits a metadata-gated route (e.g. `organizations.current`) before billing.
4. **Auth0 profile fetch failure on the miss path.** **DECIDED — fail-closed (500)** rather than provisioning a nameless user — a first-login that can't reach Auth0 is rare and retriable; a half-provisioned user is worse. Reconsider a minimal-row fallback only if this proves flaky.

## Enterprise-scale considerations

- **Concurrency & correctness** — the check-then-act (no membership ⇒ provision) is the core race; **Lean:** unique index (users) + advisory lock (org provisioning), per Decision 2. Engaged.
- **Accuracy & auditability** — provisioning already emits `org.create` + `auth.login` audit rows (`webhook.service.ts`); the self-heal path must emit them too. **Lean:** emit from `ensureProvisioned` so both entries audit identically.
- **Failure modes** — **fail-closed** (OQ4): a user who can't be provisioned is denied, not admitted role-less (the safe direction, matching `PermissionService`). Auth0/DB down → 500 + retry.
- **Scale & unbounded growth** — provisioning runs at most once per user (guarded by the membership check + unique index); no fan-out. **Lean: fine.**
- **Multi-tenancy** — each new user → their own owner-org; isolation is inherent. **Lean: fine.**
- **Contract stability** — `ensureProvisioned(sub, profile)` is the single seam #584 (invitations) and #577 (SSO on-first-token provisioning) plug into. **Lean: this is the point** — shape it so both extend it without re-plumbing call sites.
- **Data lifecycle** — N/A (no windows/retention here).

## What this doesn't decide

- **Invitations / joining an existing org** — #584. An invited user joins the invited org **only** (no personal org, OQ2); #583 builds the personal-org path + the `ensureProvisioned` seam, #584 adds the invite branch.
- **Seat limits / tier-capped membership counts** — #584 (`TierPolicy.maxSeats` is greenfield).
- **Members/Team UI** — #585.
- **Enterprise SSO on-first-token provisioning** — #577 (it will reuse `ensureProvisioned`; not built here).
- **Removing the Auth0 webhook** — kept as the eager path; this ticket makes the request path independent of it, not a replacement.

## Next step

`docs/ONBOARDING_PROVISIONING.spec.md` (the `ensureProvisioned` contract, the `users.auth0_id` unique-index migration + dedupe, the middleware self-heal behavior, error/audit shapes) and `docs/ONBOARDING_PROVISIONING.plan.md`. Provisional slicing: (1) unique index + dedupe migration + `users` on-conflict create; (2) `ensureProvisioned` (find-or-create + advisory-locked provision-if-no-membership) + webhook delegates to it; (3) `getApplicationMetadata` self-heal (+ Auth0 profile fetch, audit emission). ~3 slices, each testable; the webhook keeps working throughout.

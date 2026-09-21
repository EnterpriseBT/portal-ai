# RBAC object grants + sharing — Discovery

**Issue:** [EnterpriseBT/portal-ai#621](https://github.com/EnterpriseBT/portal-ai/issues/621)

**Why this exists.** The #598 engine resolves access from **policies attached via roles**; #620 made a user hold many roles. Neither expresses **ad-hoc, object-level access** — "let U read *this one* station", or "share this pin with the team read-write". #598 built the `visibilityPredicate` + the `share` verb + the deny→allow→implicit resolver *grant-ready* but deliberately left two things for this child: the **`permission_grants`** table (principal-bearing statements the resolver unions in) and the **wiring** of object-level enforcement into the station/pin routes — because tightening member visibility only makes sense *with* the grant mechanism that lets access back in. This is the layer that turns "sharing" into RBAC data (a materialized grant statement) rather than a bolted-on feature, plus the `ShareDialog` that authors it. The whole-engine design is recorded in the #598 discovery (D4/D9/D10, now git-only after the sweep — `git show ea29d4f7:docs/RBAC_IAM_ENGINE.discovery.md`); this doc makes it concrete against the shipped, post-#620 code.

## The current shape

### The engine (shipped #598, multi-role #620)

| Piece | Location | Note |
|---|---|---|
| `PermissionSet` | `apps/api/src/services/permission-set.ts:80` | `check`/`can` (`:86`,`:92`), `visibilityPredicate(type,{createdByCol,idCol})` (`:103`) — docstring "Built in #598; wired in #621", `resolve` deny→allow→implicit (`:178`), ownership `matches` (`:189`). **No `assertWithinBoundary` anywhere** — the boundary is net-new. |
| `loadSet` | `permission.service.ts:70` | principals = `{user, ctx.userId}` (`:75`) + one `{role,…}` per `ctx.roles` (`:81`); `policyAttachments.findByPrincipals` → policyIds → `permissionStatements.findByPolicyIds` (`:89-96`) → `new PermissionSet`. **Grants union in right here** — load `permission_grants` for the same principals and concat into the `statements` array (same shape ⇒ resolver unchanged). |
| `PermissionContext` | `permission.service.ts:19` | `{userId, organizationId, roles: OrgRole[]}`. `capabilities` maps `CALLER_CAPABILITY_ACTIONS` (`:118`). |

### Schema + models (dual-schema)

`permission_statements` (`db/schema/permission-statements.table.ts:20`): `...baseColumns` + `organizationId, policyId, effect, verb, resourceType, resourceId?(class-level when null), condition?` + CHECKs. Siblings: `permission_policies`, `policy_attachments` (`principalType/principalId`, `:24`), `roles`, `user_role`. Zod in `packages/core/src/models/permission.model.ts`: **`PERMISSION_VERBS` already includes `"share"`** (`:23`); `PERMISSION_RESOURCE_TYPES` includes `station`/`pin` (`:36`); `DATA_RESOURCE_TYPES` (`:62`, data-plane only — **station/pin are NOT in it**); `PERMISSION_CONDITIONS` = `created_by_caller`/`created_by_system` (`:80`); `POLICY_PRINCIPAL_TYPES` = `["user","role"]` (`:119`); `PermissionStatementSchema` + Model/Factory (`:153`). Registration points a new table mirrors: `db/schema/zod.ts:504`, `type-checks.ts:777`, `schema/index.ts`, `repositories/index.ts`, `db.service.ts:96`. Repo templates: `permission-statements.repository.ts` (`findByPolicyIds`), `policy-attachments.repository.ts` (`findByPrincipals`).

### Enforcement targets (currently org-scoped only — RBAC un-wired)

| Route | List `where` / `findMany` | Mutations | RBAC today |
|---|---|---|---|
| `routes/station.router.ts` | `where` `:163`, `stations.findMany` `:177` | POST `:414`, PATCH `:611`, DELETE `:807` (tx cascade `:822`) | **none** — org-scope only |
| `routes/portal-results.router.ts` (pin = **`portal_results`**, type `"pin"`) | `where` `:419`, `findMany` `:443` | POST `:108`, PATCH `:601`, DELETE `:702` | **none** |

`PermissionService` is wired only in `organization.router.ts`, `billing.service.ts`, `seat.service.ts` — never station/pin. Confirms the "tested-but-unwired" predicate.

### Seed, lifecycle, audit, FE

- **Seed** `seed.service.ts:618` (`seedRbacSystemPolicies`) iterates `SEED_SYSTEM_POLICIES` (`:699`): FullAccess `allow * *` (owner), AdminAccess `allow * *` + denies (admin), MemberAccess flatMaps `DATA_RESOURCE_TYPES` → read/write `created_by_caller` + read `created_by_system` (`:734`). **No `share` verb seeded; station/pin not granted to members at all.**
- **Lifecycle**: `seat.service.ts` `removeMember:425` soft-deletes membership + `userRole.removeAllForUser:472` under the seat lock; station DELETE cascade `station.router.ts:822`; org cascade `organization-delete.service.ts:138`.
- **Audit**: `AUDIT_ACTIONS` `audit-log.model.ts:23` (#620 added `member.role.add/remove`); `AuditService.record` fail-open (`audit.service.ts:45`).
- **FE**: `useCapabilities` `utils/use-capabilities.util.ts:27`; `sdk.members.list()` **exists** (`api/members.api.ts:16`); `InviteMemberDialog.component.tsx` is the ShareDialog model; `PageHeader.secondaryActions[]` (`packages/core/src/ui/PageHeader.tsx:13`) set in `StationDetail.view.tsx:185` + `PinnedResultDetail.view.tsx:131`. **No `AsyncSearchableSelect` exists** — a principal picker is net-new (or reuse the `SearchableSelect` family). SDK pattern: `api/<domain>.api.ts` + `keys.ts` + `sdk.ts`.

## The design space

Most of the architecture is **already decided** in the #598 record (D4 sharing = materialized grants, no cascade; D9 grants in a separate principal-bearing table unioned in the resolver; D10 share = a delegable action). The decisions below are the ones this child must *make concrete* against shipped code.

### Decision 1 — `permission_grants` shape + resolver union

A new table mirroring `permission_statements` but **principal-bearing** — `{organizationId, principalType(user|role), principalId, effect, verb, resourceType, resourceId, condition?}` — with a repo (`findByPrincipals`, `findByResource`, `create`, `hardDelete`). `loadSet` loads grants for the same principal list it already builds and concatenates into the `PermissionSet` statements.

**Lean: mirror `permission_statements` + `{principalType, principalId}`; union in `loadSet` after policy statements.** Same shape ⇒ the resolver, `visibilityPredicate`, and deny-wins need zero change — grants are just more statements.

### Decision 2 — Permissions boundary (`assertWithinBoundary`, net-new)

An admin must not grant what they don't hold. Options: **(A)** semantic — load the *granter's* own `PermissionSet` and require `granter.can(verb, {type, id})` for every statement the grant would write; **(B)** syntactic statement-subset comparison.

| | A — granter.can() per grant | B — statement subset |
|---|---|---|
| Correctness | exact (uses the real resolver) | brittle (must re-implement precedence) |
| Cost | one extra `loadSet` at share time | none extra |

**Lean: A.** Reuse the engine that already exists — for each verb the share materializes, assert the granter can do it on that object; deny grants are always within boundary (restricting is safe). One `loadSet` at share time is cheap and correct.

### Decision 3 — read / read-write materialization

This decision is about **what a share grant conveys to a *grantee*** (someone an object was shared *to*) — it does **not** govern an owner's control over objects they created (that's the ownership seed, Decision 5). The dialog offers **read** and **read-write**. Verbs are discrete in the engine (write does not imply read; `visibilityPredicate` keys on `read`/`*`). So a grant materializes: **read → `allow read`; read-write → `allow read` + `allow write`** (two grant rows). **Delete is not a share level** — a read-write grantee cannot delete a shared object; `resource.delete` on it belongs to its owner/creator (or owner/admin via role).

**Lean: grantee read = {read}, read-write = {read, write}; delete never conveyed by a share.** Matches the ticket's two-level picker and "they still can't delete something shared with them", while an **owner deletes their own** object via the `created_by_caller` `delete` seed (Decision 5) — the two paths are independent.

### Decision 4 — "the team" grantee

The picker offers users + a "the team" sentinel. Owner/admin already hold `* *`, so "team" only needs to reach **members**. With `POLICY_PRINCIPAL_TYPES = user|role`, team-share = a **grant with `principalType: role`, `principalId:` the org's `member` role**.

**Lean: "the team" = a role-principal grant to the base `member` role.** No new principal type; #622 (custom roles/groups) can generalize the sentinel later.

### Decision 5 — member baseline access to station/pin (the wiring-lockout)

Wiring `visibilityPredicate` into the station/pin list + `resource.write`/`resource.delete` into their mutations **locks members out of their own stations/pins** unless MemberAccess grants them — and today it grants only `DATA_RESOURCE_TYPES`, which excludes station/pin. So #621 must **seed member self-access**: `read/write/delete/share` on `station` + `pin` with `created_by_caller` (own objects — a member fully controls what they create, incl. deleting it), and `read created_by_system` for shared/system ones. Owner/admin already covered by `* *`. (`delete` is on the **owner's own** objects here — distinct from Decision 3, where a *grantee* of a shared object gets no delete.)

**Lean: extend `SEED_SYSTEM_POLICIES` MemberAccess with station/pin `created_by_caller` read/write/delete/share (+ system read), and ship a backfill migration** inserting these statements into every existing org's MemberAccess policy (the `0080`/`0104` cross-join template). This is a correctness prerequisite of the wiring, not an add-on.

## Tradeoff comparison

| | D1 union-in-loadSet | D2 granter.can() boundary | D3 read/{read,write} | D4 role:member team | D5 seed+backfill member self-access |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes (incl. migration) |

## Recommendation

1. Add `permission_grants` (dual-schema + repo) mirroring `permission_statements` + `{principalType, principalId}`; register at all six points.
2. Union grants-by-principal into `PermissionSet` inside `loadSet` (after policy statements); resolver/visibilityPredicate unchanged.
3. Add `PermissionSet.assertWithinBoundary(granterSet, statements)` (Decision 2A) — every allow the grant writes must be within the granter's own `can`.
4. The permission **action is `resource.share`** (verb `share`, already in `PERMISSION_VERBS`); seed it to owner/admin (via `* *`) and to a member on their own objects (`created_by_caller`). Audit actions are `grant.create` / `grant.revoke`.
5. Wire enforcement: AND `visibilityPredicate("station"/"pin", …)` into `station.router.ts:177` + `portal-results.router.ts:443`; `check(resource.write)` on POST/PATCH, `check(resource.delete)` on DELETE.
6. **Seed member station/pin self-access + backfill for existing orgs** (Decision 5).
7. Grants API: `POST /api/grants` (boundary + grantee-member + share-authority checks, transactional), `GET /api/grants?resourceType&resourceId`, `DELETE /api/grants/:id`; `@openapi` + registered schemas; `grants` SDK domain + `queryKeys.grants`.
8. `ShareDialog` (models `InviteMemberDialog`) + principal picker (`sdk.members.list()` + "the team") + read/read-write select; "Share" entries in the two `secondaryActions[]`, gated on `useCapabilities().can("resource.share")` (+ per-object).
9. Lifecycle: revoke grants in `removeMember` (after `removeAllForUser`, in the lock); cascade grant hard-delete in station/pin DELETE + `organization-delete.service.ts`.

## Open questions

1. **Read-only *deny* over a write-capable role.** The acceptance criterion "an explicit read-only deny overrides a write-capable role" needs the grant model to carry `effect: deny` and the engine to order it first (it already does). Does the **ShareDialog** author denies (a "restrict to read-only" affordance), or only allows? **Lean: dialog authors allows only (the 90% share case); the deny path is supported by the model + engine and verified with a fixture deny grant. A "restrict" affordance is a later refinement** — sharing is additive; freezing is an admin action out of this dialog's scope.
2. **`resource.share` granularity.** One org-wide share verb vs per-type (`share:station`). **Lean: one `share` verb for #621** (the engine keys share by the object's resourceType anyway); per-type is a later refinement.
3. **A recipient re-sharing.** A plain grantee gets `read`/`write` but **not** `share`, so they can't re-share (share-authority = holding `resource.share` on the object, which a recipient doesn't). **Lean: confirmed — read/read-write grants never include `share`.**

## Enterprise-scale considerations

- **Concurrency & correctness.** Share writes (grant rows + audit) run in a transaction; the boundary check is check-then-act against the granter's own perms — a concurrent perm change to the granter is a rare, low-stakes race. **Lean: transactional writes; accept the boundary race** (recorded, per #598).
- **Accuracy & auditability.** Every grant create/revoke emits an append-only `grant.create`/`grant.revoke` audit row (the SOC-2 authorization-change record). **Lean: audit every grant mutation.**
- **Failure modes.** Object enforcement is **fail-closed** — `visibilityPredicate` returns `sql\`false\`` when no allow applies; a missing grant hides the object rather than leaking it. **Lean: fail-closed on visibility (safety over availability).**
- **Scale & unbounded growth.** Row grants resolve via `resourceId IN (…)` in the predicate; a class/unconditional allow (owner/admin `*`) short-circuits it. Index `permission_grants` on `(organizationId, principalId, resourceType)` and `(resourceType, resourceId)`. Team-share (role principal) bounds fan-out vs per-user grants. **Lean: index for the predicate; note the row-grant ceiling, don't cap.**
- **Multi-tenancy.** All grants org-scoped; the grantee must be an active member of the **same** org (validated at share time → `RBAC_GRANTEE_NOT_MEMBER`); no cross-org grant is expressible. **Lean: org-scope + validate grantee membership.**
- **Contract stability.** The grant statement shape = the policy statement shape, so #622 (custom roles/groups) shares to a group by adding a `principalType` value, not re-plumbing the resolver. **Lean: reuse the statement contract; principal set is the only extension point.**
- **Data lifecycle.** Grants follow their **object** (kept on soft-delete, hard-deleted with it) and their **principal** (revoked on member removal). No time window. The member self-access seed needs a **backfill for existing orgs** (per the #581 backfill-coverage rule) or the wiring strands them. **Lean: object/principal-lifecycle-bound + a MemberAccess backfill migration.**

## What this doesn't decide

- **Sharing to arbitrary groups** — needs the groups principal from #622. This child shares to **user + team (role:member)** only.
- **Data exposure through shared objects** (definer's-rights views, curated row/column filters) + the **`views` entity** — **#599** (the ABAC substitute). #621 grants the *object*, not the data slice.
- **Entity-record / field-mapping / connector RBAC enforcement** (incl. **member delete-own of their records**) — **#599**, not #621. #621 wires **station + pin only**, so members' delete of their own records stays on the current org-scoped path — no regression. A prerequisite #599 must resolve: records written through a connector / portal session are currently `createdBy = system`, not the member, so `created_by_caller` wouldn't match them — #599 must decide what "own" means for a synced record before it can seed member delete-own on data types.
- **General parameterized ABAC `condition` grants** — later, likely unneeded (views cover attribute slicing).
- **The `ShareDialog` deny/"restrict" affordance** — OQ1; the model + engine support it, the UI is deferred.

## Next step

`docs/RBAC_OBJECT_GRANTS.spec.md` pins the contract: the `permission_grants` table + Zod model + repo (with `findByPrincipals`/`findByResource`), the `loadSet` union point, `assertWithinBoundary`, the three `/api/grants` endpoints + `@openapi` schemas + `ApiCode`s (`RBAC_GRANT_EXCEEDS_BOUNDARY`, `RBAC_GRANTEE_NOT_MEMBER`), the seed additions + **backfill migration**, the station/pin wiring points, the FE `ShareDialog` + `grants` SDK + capability gate, and the lifecycle cascades — with the TDD case list. `docs/RBAC_OBJECT_GRANTS.plan.md` then slices it, roughly: (1) `permission_grants` schema + model + repo + resolver union (engine sees grants, still un-wired); (2) grants API + boundary + share-authority + seed/backfill + audit; (3) station/pin enforcement wiring (visibility + write/delete checks) — the member-lockout-sensitive slice, gated behind slice 2's seed; (4) FE ShareDialog + SDK + capability-gated entry points; each behind a green suite.

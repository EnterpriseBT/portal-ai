# RBAC object grants + sharing — Spec

The contract for [#621](https://github.com/EnterpriseBT/portal-ai/issues/621): a `permission_grants` table the engine unions in, a permissions boundary, the station/pin object-enforcement wiring deferred from #598, the `/api/grants` API, seed + backfill of member own-object `delete`/`share`, and the `ShareDialog`. Builds on `docs/RBAC_OBJECT_GRANTS.discovery.md` (this branch) + the shipped #598 engine / #620 multi-role.

## Key decisions (confirmed in discovery)

1. **Grants = principal-bearing statements in a new `permission_grants` table**, unioned into `PermissionSet` in `loadSet` — same five resolver fields as `permission_statements`, so the resolver/visibilityPredicate/deny-wins are unchanged (D9/D1).
2. **`assertWithinBoundary` is net-new** — semantic: each allow a grant writes must satisfy the *granter's own* `can(verb, object)` (D2-A). Denies are always in-boundary.
3. **Grantee levels: read → `{allow read}`, read-write → `{allow read, allow write}`.** A grantee never gets `delete` or `share` (Decision 3). Deleting/sharing a *shared* object is not conveyed.
4. **Owners fully control their own objects.** A member already has read/write on `created_by_caller` station/pin (via the existing `DATA_RESOURCE_TYPES` MemberAccess flatMap); #621 **adds `delete` + `share` on `created_by_caller` for `station` + `pin`** so a member can delete and share what they created (Decision 5). Entity-record delete-own is **#599** (blocked on the `createdBy=system` question).
5. **"The team" grantee = a `role`-principal grant to the org's base `member` role** (owner/admin already see everything via `* *`) (D4).
6. **The permission action is `resource.share`** (verb `share`, already in `PERMISSION_VERBS`); audit actions are `grant.create` / `grant.revoke`.
7. Enforcement is **fail-closed** (visibilityPredicate → `sql\`false\`` when no allow applies); grant writes + cascades are **transactional**; the boundary check-then-act race is accepted (recorded).

## Scope

### In scope
`permission_grants` (table/model/repo) + resolver union; `assertWithinBoundary`; `/api/grants` POST/GET/DELETE; seed + backfill of member `delete`/`share` on own station/pin; wiring `visibilityPredicate` + `resource.write`/`resource.delete` into station + pin routes; per-object `canShare` on their detail responses; `ShareDialog` + `grants` SDK + capability-gated entry points; lifecycle cascades (member removal, hardDelete, org delete); `grant.create`/`grant.revoke` audit.

### Out of scope
Groups principal (#622); views + data-plane exposure + entity-record RBAC (#599); a deny/"restrict" affordance in the dialog (model+engine support it, UI deferred — OQ1); per-type `share:station` granularity (OQ2).

## Surface

### Core — `packages/core/src/models/permission.model.ts`
Add, mirroring `PermissionStatementSchema` (`:153`) but principal-bearing:
```ts
export const PermissionGrantSchema = CoreSchema.extend({
  organizationId: z.string(),
  principalType: PolicyPrincipalTypeSchema,   // "user" | "role"
  principalId: z.string(),
  effect: PermissionEffectSchema,
  verb: PermissionVerbSchema,
  resourceType: PermissionResourceTypeSchema,
  resourceId: z.string().nullable(),          // grants are always instance-level in #621 (non-null)
  condition: PermissionConditionSchema.nullable(),
});
```
+ `PermissionGrantModel` / `PermissionGrantModelFactory` (copy the statement pair). Add `SHAREABLE_RESOURCE_TYPES = ["station","pin"] as const satisfies readonly PermissionResourceType[]` (the D8 governance set with ownership+grants+sharing). No change to `CALLER_CAPABILITY_ACTIONS` — `resource.share` is per-object, not an app-level capability.

### Core — `packages/core/src/contracts/grant.contract.ts` (new)
```ts
GrantAccessSchema = z.enum(["read", "read-write"]);
ShareGranteeSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("user"), userId: z.string() }),
  z.object({ type: z.literal("team") }),                    // → role:member
]);
ShareGrantRequestSchema = z.object({
  resourceType: z.enum(["station","pin"]),
  resourceId: z.string(),
  grantee: ShareGranteeSchema,
  access: GrantAccessSchema,
});
GrantViewSchema = z.object({          // one row per (principal, resource) — verbs grouped
  id: z.string(),                     // representative grant-row id; DELETE /:id revokes the whole share
  principalType: PolicyPrincipalTypeSchema,
  principalId: z.string(),
  principalLabel: z.string(),         // member email/name, or "The team"
  access: GrantAccessSchema,          // derived: {read}→read, {read,write}→read-write
});
GrantListResponseSchema = z.object({ grants: z.array(GrantViewSchema) });
ShareGrantResponseSchema = z.object({ grant: GrantViewSchema });
```

### Core — `packages/core/src/models/audit-log.model.ts:23`
Add `"grant.create"`, `"grant.revoke"` to `AUDIT_ACTIONS`.

### Core — station/pin detail responses
Add `canShare: z.boolean()` to the station detail + pinned-result detail response contracts (whichever schema `GET /:id` returns) — server-computed `set.can("resource.share", object)`. The FE gates the Share entry on it.

### API — `apps/api/src/db/schema/permission-grants.table.ts` (new)
`pgTable("permission_grants", { ...baseColumns, organizationId, principalType, principalId, effect, verb, resourceType, resourceId, condition })`, mirroring `permission-statements.table.ts:20`. Indexes: `(organizationId, principalId, resourceType)` (resolver lookup by principal) and `(organizationId, resourceType, resourceId)` (the share-list + cascade). Register at all six points: `schema/zod.ts:504` (create select/insert), `type-checks.ts:777` (bidirectional `IsAssignable`), `schema/index.ts`, `repositories/index.ts`, `db.service.ts:96`.

### API — `apps/api/src/db/repositories/permission-grants.repository.ts` (new)
`findByPrincipals(principals, organizationId, client)` (mirror `policy-attachments.repository.ts` per-principal load), `findByResource(organizationId, resourceType, resourceId, client)`, `createMany(rows, client)`, `hardDeleteByResource(organizationId, resourceType, resourceId, client)`, `hardDeleteByPrincipal(organizationId, principalType, principalId, client)`, `findById`. (Grants hard-delete — no soft-delete tombstones for authz rows.)

### API — engine
- `permission-set.ts`: widen the constructor's `statements` param to a structural `EffectiveStatement` = `Pick<PermissionStatementSelect,"effect"|"verb"|"resourceType"|"resourceId"|"condition">` (a `PermissionGrantSelect` already satisfies it). Add:
  ```ts
  assertWithinBoundary(statements: EffectiveStatement[]): void
  ```
  For every `effect:"allow"` statement, require `this.can(<verb>, {type: resourceType, id: resourceId, createdBy})` on *this* (the granter's) set; throw `ApiError(403, RBAC_GRANT_EXCEEDS_BOUNDARY, …)` on the first miss. `deny` statements pass (restricting is in-boundary).
- `permission.service.ts` `loadSet` (`:92`): after `permissionStatements.findByPolicyIds`, load `repo.permissionGrants.findByPrincipals(principals, ctx.organizationId, client)` and pass `[...statements, ...grants]` to `new PermissionSet`. (Grants share the resolver fields ⇒ no resolver change.)

### API — `apps/api/src/constants/api-codes.constants.ts`
Add `RBAC_GRANT_EXCEEDS_BOUNDARY = "RBAC_GRANT_EXCEEDS_BOUNDARY"` (403), `RBAC_GRANTEE_NOT_MEMBER = "RBAC_GRANTEE_NOT_MEMBER"` (400).

### API — `apps/api/src/routes/grant.router.ts` (new, mounted `/api/grants`)
- **`POST /`** — body `ShareGrantRequest`. Order: resolve caller ctx + the target object (404 if absent); `check(ctx,"resource.share",{type,id,createdBy})` (403 if the caller can't share it); resolve grantee → principal (`user`→validate active membership via `organizationUsers.findByOrganizationAndUser` else `RBAC_GRANTEE_NOT_MEMBER`; `team`→`{role, <member-role id>}`); build the allow statements (read→`[read]`, read-write→`[read,write]`) as grant rows; `granterSet.assertWithinBoundary(newAllows)`; **transaction**: delete any existing rows for that (principal, resource) then insert the new set (idempotent re-share); post-commit `grant.create` audit. → `ShareGrantResponse`.
- **`GET /?resourceType&resourceId`** — `check(ctx,"resource.share",{type,id})`; `findByResource` grouped into `GrantView[]` (principalLabel resolved from members list / "The team"). → `GrantListResponse`.
- **`DELETE /:id`** — load the row (404), derive its (principal, resource), `check(ctx,"resource.share",{type,id})`, hard-delete **all rows** of that principal+resource in a tx; `grant.revoke` audit. → 204/`{ id }`.
- Every handler carries an `@openapi` block; register `ShareGrantRequest`/`GrantView`/`GrantListResponse`/`ShareGrantResponse` in `swagger.config.ts`.

### API — station/pin wiring
- `station.router.ts`: list (`:163-177`) — AND `set.visibilityPredicate("station",{createdByCol:stations.createdBy,idCol:stations.id})` into `where`; POST (`:414`) `check(ctx,"resource.write",{type:"station",createdBy:ctx.userId})`; PATCH (`:611`) `check(resource.write, {…, createdBy: row.createdBy})`; DELETE (`:807`) `check(resource.delete, {…})`; detail (`:283`) compute `canShare`.
- `portal-results.router.ts` (pin): list (`:419-443`) AND `visibilityPredicate("pin",…)`; POST/PATCH `resource.write`; DELETE (`:702`) `resource.delete`; detail `canShare`.
- Load the set **once per request** (`PermissionService.loadSet`), reuse for predicate + checks (never per-row).

### API — seed — `apps/api/src/services/seed.service.ts:734`
Append to `MemberAccess.statements`, for each `rt` in `SHAREABLE_RESOURCE_TYPES`: `{allow, delete, rt, created_by_caller}` + `{allow, share, rt, created_by_caller}`. (Read/write already present via the `DATA_RESOURCE_TYPES` flatMap.)

## Migration + Seed

- **`npm run db:generate -- --name add_permission_grants`** — the `permission_grants` table (create-only, non-destructive).
- **Backfill migration** (`<n>_backfill-member-share-delete-grants.sql`, hand-written + journal entry, no snapshot — the `0104` template): for every existing org's `MemberAccess` policy, insert the four new statements (`delete`+`share` × `station`+`pin`, `created_by_caller`), `ON CONFLICT DO NOTHING` restating the statement uniqueness predicate; marked `-- backfill:member-share-delete`. Without it, members in existing orgs can't delete/share their own station/pin after the wiring lands. (Grants themselves need no backfill — none exist pre-feature.)

## TDD test plan

### Core — `packages/core/src/__tests__/{models/permission.model.test.ts, contracts/grant.contract.test.ts, models/audit-log.model.test.ts}`
`PermissionGrantSchema` round-trips + rejects a bad principalType/verb; `ShareGrantRequestSchema` accepts user + team grantees, rejects unknown access; `GrantView`/`GrantListResponse` shapes; `grant.create`/`grant.revoke` in `AUDIT_ACTIONS`. ~10 cases.

### API unit — `apps/api/src/__tests__/services/permission-set.test.ts`
`assertWithinBoundary`: passes when allows ⊆ granter's `can`; throws `RBAC_GRANT_EXCEEDS_BOUNDARY` on the first out-of-boundary allow; deny statements always pass. `visibilityPredicate` with a grant allow surfaces the shared instance; a grant `deny` subtracts it. ~8 cases.

### API integration — `apps/api/src/__tests__/__integration__/{services/permission-loadset.integration.test.ts, db/repositories/permission-grants.repository.integration.test.ts, routes/grant.router.integration.test.ts, routes/station.router.integration.test.ts, routes/portal-results.router.integration.test.ts, services/seat.service.integration.test.ts}`
loadSet unions grants (user + role principal); repo `findByPrincipals`/`findByResource`/cascades; **grants API**: share read/read-write (materialized rows + audit), boundary rejection, grantee-not-member, share-authority (a plain grantee's POST 403s; owner/admin/creator succeeds), team share (role:member), GET grouping, DELETE revokes all verb rows; **wiring**: a member sees own+system+shared stations/pins not others' (visibility), a read grantee can read not write (403), a read-write grantee can write, an explicit deny grant overrides a write-capable role, a member can delete+share their own station/pin but not a shared one; **lifecycle**: `removeMember` revokes the member's grants, station/pin `hardDelete` + org delete cascade grants. ~28 cases.

### API — migration/seed
A backfill-coverage integration test (mirror `seed-backfill-coverage.test.ts`): the new MemberAccess statements are inserted for a pre-existing org by the backfill SQL; provisioning a new org includes them. ~3 cases.

### Web — `apps/web/src/__tests__/{ShareDialog.test.tsx, StationDetail…, PinnedResultDetail…}`
`ShareDialog`: renders grantee picker + access select, submits `ShareGrantRequest`, shows `FormAlert` on `serverError`, lists current grants + revoke; the Share `secondaryActions` entry renders only when `canShare`. Follows the Dialog & Form Test Checklist. ~10 cases.

**Totals ≈ 59 cases.** Run via `npm run test:unit` / `npm run test:integration` per package (never raw jest).

## Acceptance criteria

- A member granted read (or read-write) on a station/pin they didn't create can access exactly it; an explicit read-only **deny** grant overrides a write-capable role.
- Sharing conveys **exactly that object** — list reads reflect grants via the one `visibilityPredicate`; no subtree/siblings.
- An admin cannot grant beyond their own allow-set (`RBAC_GRANT_EXCEEDS_BOUNDARY`); the grantee must be an active org member (`RBAC_GRANTEE_NOT_MEMBER`); a plain grantee cannot re-share.
- A member can **delete and share their own** station/pin; a grantee of a shared object can do **neither**.
- `hardDelete` + member removal revoke the associated grants; every grant create/revoke is audited.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Wiring locks members out of their own station/pin | read/write already seeded; #621 adds delete/share + **backfill** for existing orgs; visibility fail-closed but own+system always allowed. |
| Boundary check-then-act race (granter's perms change mid-share) | Accepted — rare, low-stakes; transactional grant write. |
| A missed enforcement site leaks/over-restricts | Integration tests assert own/system/shared/other visibility per role; load-set-once avoids per-row drift. |

**Rollback:** revert the wiring + `git revert`; the `permission_grants` table can be dropped (no grants pre-feature); the backfilled MemberAccess statements are additive (harmless if the wiring is reverted).

## Files touched

New: `permission-grants.table.ts`, `permission-grants.repository.ts`, `grant.router.ts`, `packages/core/src/contracts/grant.contract.ts`, `apps/web/src/components/ShareDialog.component.tsx`, `apps/web/src/api/grants.api.ts`, the two migrations. Edit: `permission.model.ts`, `audit-log.model.ts`, station/pin detail contracts, `permission-set.ts`, `permission.service.ts`, `seed.service.ts`, `api-codes.constants.ts`, `swagger.config.ts`, `station.router.ts`, `portal-results.router.ts`, `seat.service.ts`, `organization-delete.service.ts`, `schema/{index,zod}.ts`, `type-checks.ts`, `repositories/index.ts`, `db.service.ts`, web `keys.ts`/`sdk.ts` + StationDetail/PinnedResultDetail views.

## Next step

`/plan 621` slices this on this branch, roughly: (1) `permission_grants` schema+model+repo + `loadSet` union (engine sees grants, un-wired); (2) `assertWithinBoundary` + `/api/grants` API + seed/backfill + audit + lifecycle revoke; (3) station/pin enforcement wiring + `canShare` (the member-lockout-sensitive slice, behind slice 2's seed); (4) FE `ShareDialog` + `grants` SDK + capability-gated entry points — each behind a green suite.

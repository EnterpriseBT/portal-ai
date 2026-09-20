# RBAC IAM engine: policies, groups, object grants + sharing — Discovery

**Issue:** [EnterpriseBT/portal-ai#598](https://github.com/EnterpriseBT/portal-ai/issues/598)

**Why this exists.** #576 shipped the org role model as a **hardcoded `switch`** in `permission.service.ts` — `owner`/`admin`/`member` decided in code, with the `resolveEffect` + `visibilityPredicate` seam built *grant-ready* but backed by no schema. The role enum alone can't express object-level access, read-only overrides, or sharing. This ticket stands up the data-driven authorization **engine** behind #576's seam — policies as allow/deny statements over `action × resource`, roles and groups as policy-attachment principals, object grants, and sharing — modelled on **AWS IAM** so the semantics are ones every security reviewer already knows. This is the engine that turns the coarse role switch into data and makes sharing fall out of RBAC rather than being bolted on.

*Design converged with the ticket owner in a pre-discovery architecture walk; the decisions below are recorded as agreed (D1–D10), not as open leans.*

**This is the whole-engine design record; it is realized across four #578 children** (each gets its own spec/plan — this doc is their shared reference):
- **#598** (this ticket) — the engine + system policies (data-driven roles) + both provisioning paths + **switch retirement**. Behavior-preserving; `visibilityPredicate`/object checks are built but **not wired into routes**.
- **#620** — multi-role (`user_role` + enum cutover + multi-role Members UI).
- **#621** — object grants + sharing (`permission_grants` + wiring object-level enforcement into station/pin + `ShareDialog`).
- **#622** — custom roles, policies & groups (authoring UI; `groups`/`user_group`/`group` principal).

## The current shape

### The #576 seam (what we extend, and its live blast radius)

| Piece | Location | Note |
|---|---|---|
| Resolver | `apps/api/src/services/permission.service.ts:98` (`resolveEffect` switch) | The plug-point. `check:64` (mutation guard, throws 403) + `visibilityPredicate:85` (SQL clause for lists) are the public entry points to preserve. |
| `check` callers (preserve) | `organization.router.ts:304,428,1436`; `billing.service.ts:226,320`; `seat.service.ts:65,145,155,187,212,235,397` | org.delete, member.role.assign, org.audit.read, billing.manage, member.invite/remove. |
| `visibilityPredicate` callers | **none** | Defined + unit-tested, AND-ed into zero list queries. |
| `resource.read`/`resource.write` | inside `resolveEffect` only | **No live callers** — object read/write enforcement starts here. |
| Caller context | `middleware/metadata.middleware.ts:90,127` | `{userId, organizationId, role}` on `req.application.metadata` — this *is* `PermissionContext`. |

### Role & membership; grantable objects; seed/audit/schema

| Piece | Location | Note |
|---|---|---|
| Membership + role enum | `db/schema/organization-users.table.ts`, `packages/core/src/models/organization-user.model.ts` (`ORG_ROLES`) | Role assign `organization.router.ts:428`; create `application.service.ts:469,524`; **remove** `seat.service.ts:395` (`removeMember`, soft-delete under `withSeatLock` — must revoke grants). |
| Stations / pins | `db/schema/stations.table.ts`, `portal-results.table.ts`; lists `station.router.ts:155`, `portal-results.router.ts:411` | `createdBy` from `baseColumns`, stamped with the **acting user** (pin: `portal-results.router.ts:198` `createdBy: userId`). Lists org-scoped only today. |
| Views | — | **No table exists** — net-new in **#599**. #598 shares station + pin; reserves the `view` resourceType. |
| Data-plane attribution | connector setup `createdBy: userId`; sync `createdBy: actor`; portal messages `portal.createdBy` | Entity records / field mappings are system/sync-attributed — provenance, not an access key (see D8). |
| Per-org seed + backfill | `seed.service.ts:571` / `application.service.ts:585`; coverage guard `__tests__/services/seed-backfill-coverage.test.ts`; marker `drizzle/0080_…`; role precedent `drizzle/0097_…` | System policies seed per org + a paired backfill migration for existing orgs. |
| Audit (#575) | `audit.service.ts:45` (`record`, fail-open), `audit-log.table.ts` (append-only), `AUDIT_ACTIONS` | Policy/grant/attachment mutations emit new actions. |
| Schema-add (4 layers) + cascade | model → `*.table.ts` → `zod.ts` → `type-checks.ts` (template: **entity-tags**); `base.repository.ts` `hardDelete:369` own-table only; ordered cascade `organization-delete.service.ts:138` | Template for the new tables; revocation follows the explicit-ordered-cascade. |

### Frontend

`useRole()` (`apps/web/src/utils/use-role.util.ts:22`) drives UI gating. Share entry points: `PageHeader.secondaryActions[]` on `StationDetail.view.tsx:185` + `PinnedResultDetail.view.tsx:131`. `ShareDialog` models on `InviteMemberDialog.component.tsx`. Grantee picker: `AsyncSearchableSelect` fed by `sdk.members.list()` (**none exists yet**) + a "the team" sentinel. New `grants` SDK domain follows `stations.api.ts` + `keys.ts` + self-invalidation.

## The design decisions

### D1 — Engine model = AWS IAM

User/Role/Policy/Group + `user_role`, `user_group`, and one **polymorphic `policy_attachment {policyId, principalType: user|role|group, principalId}`**. A user's effective policy set = union of policies attached directly + via each role + via each group.

### D2 — Resolution = pure AWS semantics

Implicit deny → explicit **allow** → explicit **deny wins**. **No specificity ranking.**

### D3 — Statement shape (with a bounded condition)

`{effect: allow|deny, action, resourceType, resourceId?, condition?}`. `resourceId` NULL = class (`station:*`); set = instance. **`condition` is a closed, SQL-translatable vocabulary — for #598, `createdBy ∈ {caller, system}` only** (see D6). Forward-compatible with general ABAC (a later child), which is *not* needed because data-attribute slicing is done with **views** (D6/region).

### D4 — Sharing = materialized grant statements

"Share station X (read) with U" writes an explicit grant `allow U read station:<X>` (+ attached views once #599 exists), computed at share time — **no implicit cascade, no read-time FK walk**. Data *exposure* through the object is #599.

### D5 — Statement storage: normalized child rows *(confirmed)*

`permission_statements` as indexable rows (indexed `(resourceType, resourceId)`), **not** JSONB — the visibility predicate must be pure SQL (`id IN (…)`), never per-row (#440). A policy is the named container; statements are its rows.

### D6 — Ownership is a bounded condition, not resolver code *(revised & confirmed)*

The member default — "read/write rows I created, read system rows" — is attribute-based, so it's a **statement condition**, not a hardcoded baseline:

```
MemberAccess = [ allow read,write resource:* IF createdBy=caller ;  allow read resource:* IF createdBy=system ]
AdminAccess  = [ allow read,write resource:* (+ member.*, org.audit.read …) ]     # unconditional
FullAccess   = [ allow * * ]
```

This makes system roles **pure data**: removing MemberAccess from a user removes their ownership access; a custom policy can scope ownership to a subset (`allow read station:* IF createdBy=caller`). It reintroduces **no** write-amplification/backfill — the condition is *evaluated at resolve time* (guard: compare `object.createdBy`; list: emit `createdBy = :caller`), nothing materialized. The vocabulary stays closed at `createdBy ∈ {caller, system}` because **data-attribute slicing is done with views, not conditions**.

**Region example (why ABAC isn't needed):** a view is a row/column filter on an entity record set (`region = 'west'`, #599); create a view per region, a group per region, a policy `allow read view:<westViewId>` attached to that group. The filter lives in the view; the grant is a plain instance grant. So arbitrary ABAC conditions may never be needed — the region-wiring machinery (groups, policy-to-group, `view:<id>` grants) is **#598**; the view *entity* is **#599**.

### D7 — Explicit deny overrides ownership *(confirmed)*

Resolution order: **explicit deny → explicit allow (conditional or not) → role default → implicit deny.** An admin's `deny U write station:<X>` beats U's ownership allow (admin can freeze); a member can't self-deny (can't attach denies). Abuse bounded by the permissions boundary + share-authority rule.

### D8 — Object-type governance (three-way) + data-plane provenance

Not every type is ownership-scoped. This is why system/sync attribution on data-plane rows is harmless — nobody's access depends on it.

| Object types | Governance | Share UI? |
|---|---|---|
| **stations, pins** (+ views, #599) | ownership (`createdBy=caller`) + grants + sharing | **Yes** |
| **portal sessions** | ownership — **private to creator**; a text thread with the agent | **No** — engine can grant `portal:<id>`, but the product never offers it; steer to sharing station/pin |
| **entities, entity records, field mappings, connector instances** | **grant / view / policy only** — admin-configured, *never* ownership | No — data-plane; member scoping is **#599** (views + definer's rights) |

**Sequencing:** #598 wires enforcement into **station + pin** lists/mutations; **data-plane member scoping is #599** (views are the access path) — until then data-plane stays org-scoped/admin-configured (no regression). Data-plane `createdBy` is **provenance, not an access key**; the audit log (#575) already records the *acting* user for actions regardless of the row's `createdBy`.

### D9 — Grants live in a separate `permission_grants` table *(OQ1 resolved)*

Same statement *shape* as policy statements but **principal-bearing** (`{principalType, principalId, effect, action, resourceType, resourceId, condition?}`), unioned with policy-statements in the resolver. Policies = reusable named bundles (system/custom/role-and-group defaults); grants = ad-hoc per-principal object sharing. Avoids a policy-per-user.

### D10 — "Who can share" is an action, seeded to reproduce the rule *(OQ5 resolved)*

Sharing is a permission **action** (`grant.create`), governed by the engine and **delegable**, seeded so owner/admin hold it and creators hold it on their own objects (via the ownership condition) — reproducing "owner/admin/createdBy can share" by default while letting an admin delegate re-sharing.

## Recommendation

1. **Schema** (dual-schema, entity-tags template): `permission_policies`, `permission_statements` (`policyId, effect, action, resourceType, resourceId?, condition?`, indexed), `policy_attachments` (polymorphic), `permission_grants` (principal-bearing, same shape), `roles`, `groups`, `user_role`, `user_group`.
2. **System policies as data** (D6), seeded in `provisionOrganizationWorkspace` + a backfill migration (coverage marker) for existing orgs; org creator → Owner + FullAccess.
3. **Engine in `resolveEffect`** (D7 order): gather effective statements (policies via attachments ∪ grants by principal), evaluate conditions (guard: compare `createdBy`; list: translate to SQL). **Resolve once per request**, never per check/row.
4. **Wire `visibilityPredicate`** into the station + pin list queries — one clause composing conditional allows (`createdBy=:caller`), instance allows (`id IN(…)`), minus denies; `undefined` on an unconditional class allow / owner-admin.
5. **Object grants + sharing** for station + pin: `grants` SDK domain; `ShareDialog` (modeled on `InviteMemberDialog`) with an `AsyncSearchableSelect` grantee picker (`sdk.members.list()` + "the team" sentinel) + read/read-write Select; share writes materialized grants in a transaction; `grant.create` action-gated; audited.
6. **Permissions boundary:** an admin's authored grants/policies validated so granted actions ⊆ the admin's own effective allow-set.
7. **Lifecycle cascades** (ordered, `organization-delete.service` pattern): object `hardDelete` → delete its statements/grants; `removeMember` → revoke the user's attachments + grants in the same transaction; soft-deleted objects keep grants.

## Confirmed operating decisions (were open questions)

- **Cardinality (OQ2):** row-grant `IN (…)` is acceptable; groups bound fan-out; a class/unconditional allow short-circuits the list filter. Note the ceiling, don't cap.
- **Failure mode (OQ3):** **fail-closed** — a resolution error denies the guard and shows own/none on lists (never all; show-all is a data leak). Deliberately opposite the cost gate's fail-open.
- **Caching (OQ4):** per-request resolution only, **no cross-request cache** — authz staleness after a revoke is a security bug; revisit with explicit invalidation only if hot.

## Open questions

1. **Admin/owner oversight of private portal sessions** — should owner/admin be able to read another member's portal thread (support/audit), or is it strictly private to the creator? **Lean: private by default; owner/admin do *not* get thread contents** (least-privilege; the audit log covers oversight of *actions*). A future explicit `portal:<id>` grant remains possible.
2. **`grant.create` granularity** — one org-wide share-authority action, or per-resource-type (`grant.create:station`)? **Lean: one action for #598** (per-type is a later refinement if needed).

## Enterprise-scale considerations

- **Concurrency & correctness.** Share-time expansion + cascades run in a transaction. The permissions-boundary check is check-then-act; a concurrent change to the admin's own perms is a rare, low-stakes race. **Lean: transactional writes; accept the boundary race.**
- **Accuracy & auditability.** Every policy/statement/attachment/grant mutation emits an append-only `AUDIT_ACTIONS` row (#575) — the SOC 2 authorization-change record. **Lean: audit every authz mutation.**
- **Failure modes.** Fail-**closed** (OQ3), the opposite of the cost gate by design. **Lean: fail-closed guard + list.**
- **Scale & unbounded growth.** Row-grant cardinality (OQ2); groups are the pressure valve; statements indexed on `(resourceType, resourceId)` + `(policyId)`, grants on `(principalId, resourceType)`. **Lean: index for the predicate; groups bound fan-out.**
- **Multi-tenancy.** All rows org-scoped; a grantee must be an active member of the same org (validated at share time); no cross-org grant is expressible. **Lean: org-scope + validate grantee membership.**
- **Contract stability.** The statement shape reserves `condition` (ABAC later) and custom roles (a policy attached as a role default) with no call-site re-plumbing; views (#599) plug in via the reserved `view` resourceType. **Lean: forward-compatible shape.**
- **Data lifecycle.** Grants follow their object (kept on soft-delete, cascaded on hardDelete) and principal (revoked on member removal). No arbitrary time window. **Lean: object/principal-lifecycle-bound.**

## What this doesn't decide

- **Data exposure through shared objects** (definer's rights, curated column/row filters, per-caller tool-auth) + the **`views` entity** — **#599**. #598 grants the *object*; #599 governs the *data* and introduces views (the ABAC substitute).
- **Member scoping of data-plane objects** (entity records, field mappings) — arrives with #599's views; #598 leaves them org-scoped/admin-configured (no regression).
- **Multi-role** (a user holding several roles: `user_role` + the enum→join cutover + multi-role Members UI) — **#620**.
- **Object grants + sharing** (`permission_grants`, the grants API, `ShareDialog`, and wiring `visibilityPredicate`/object checks into station/pin) — **#621**. Wiring lands here (not #598) so member visibility tightens *with* the grant mechanism.
- **Groups + custom roles/policies + the authoring UI** (`groups`/`user_group`/`group` principal, custom CRUD/assignment) — **#622**; the schema + engine are shaped for them now.
- **Data exposure through shared objects** + the **`views` entity** + data-plane member scoping — **#599** (the ABAC substitute).
- **General/parameterized ABAC `Condition` grants** — a later child, likely unneeded (views cover data-attribute slicing).
- **Per-user provenance on agent-driven data-plane writes** — an attribution/audit refinement, separable from authz; its own small ticket if wanted.

## Next step

**This doc's contract is split across four specs** (the design record stays whole here). **#598's** `docs/RBAC_IAM_ENGINE.spec.md` pins only the **engine foundation**: the four tables (`permission_policies`/`permission_statements`/`policy_attachments`/`roles`) + dual-schema, the system-policy seed rows + existing-org backfill, the `PermissionSet` engine (`loadSet` + `check`/`visibilityPredicate`/`assertWithinBoundary` + condition translation, `visibilityPredicate` tested-but-unwired), and the privileged `check` call-site migration + **switch retirement** (switch-parity the gate). #598's plan slices it: (1) schema + models + system policies + seed/backfill (engine dormant, parity proven); (2) `PermissionSet` + `loadSet` + middleware attach + migrate the `check` sites + delete the switch. `permission_grants` + object-enforcement wiring (#621), `user_role`/multi-role (#620), and `groups`/custom-authoring (#622) get their own specs/plans on their own branches.

# Policy attach is org-scoped: Condensed design (#681)

**Issue:** [EnterpriseBT/portal-ai#681](https://github.com/EnterpriseBT/portal-ai/issues/681) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc). Security review **required** (multi-tenancy).

**Why.** Attaching policies to a group or role never checks that the `policyIds` belong to the caller's org.
- An id naming no policy reaches the `policy_attachments` insert and fails its FK, so the caller gets a 500.
- Another org's policy id is accepted (200).
- `PermissionService.loadSet` org-filters the *attachments* but loads the *statements* by policy id alone. So once org A attaches org B's custom policy, B's statements are evaluated in A, and B's later edits reach A's members with no boundary check.

Fix the write path (validate up front, 400) and the read path (statements scoped to the caller's org) in `apps/api` only.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Group create / update | `apps/api/src/services/group.service.ts:184`, `:241` | `assertPoliciesWithinBoundary`, then `setPoliciesForPrincipal`; no org check on `policyIds` |
| Role create / update | `apps/api/src/services/role.service.ts:254`, `:303` → `syncPolicies` `:133` | same shape, own copy of `assertPoliciesWithinBoundary` (`:46`) |
| Boundary check | `group.service.ts:41`, `role.service.ts:46` | `permissionStatements.findByPolicyIds(policyIds)`, unscoped |
| Attachment insert | `apps/api/src/db/repositories/policy-attachments.repository.ts:90-118` | stamps the caller's `organizationId`; relies on the FK for existence, which is where the 500 comes from |
| Read path | `apps/api/src/services/permission.service.ts:114-121` | attachments filtered by `ctx.organizationId`; `findByPolicyIds(policyIds)` is not |
| Statements repo | `apps/api/src/db/repositories/permission-statements.repository.ts:26` | `findByPolicyIds(policyIds)`; 4 callers (group, role, permission, `policy.service.ts:172` list) |
| Policies repo | `apps/api/src/db/repositories/permission-policies.repository.ts` | `findByName`, `findByOrganizationId`; no by-ids-in-org finder |
| Codes | `apps/api/src/constants/api-codes.constants.ts:66-81` | `POLICY_NOT_FOUND` is a 404 for a path id; nothing for an unknown id inside a body |

`permission_statements` carries `organization_id` (`permission-statements.table.ts:24`), so the read path can scope without a join. Local data: 0 attachments and 0 statements whose org differs from their policy's.

## Decision: validate on write, scope on read, one shared helper

**Write.**
- A new `PermissionPoliciesRepository.findByIdsInOrg(organizationId, ids)` returns the live policies with `id IN (…) AND organization_id = ? AND deleted IS NULL`.
- A shared `RbacPolicyRefs.assertAttachable(caller, policyIds)` dedupes the ids, loads them in-org, and throws **400 `RBAC_POLICY_UNKNOWN`** listing every id not found. The response is the same whether an id is absent, deleted or another org's, so existence isn't revealed.
- It replaces the existence part of both services' `assertPoliciesWithinBoundary`. The boundary check then runs on the in-org statements. It runs before any write, so nothing is created on refusal.

**Read (defence in depth).**
- `findByPolicyIds(organizationId, policyIds)`: the org is **required**, and all four callers pass `caller.organizationId` / `ctx.organizationId`.
- A row that predates the fix, or any future path that skips the write check, can then never pull another org's statements into a permission set.

**No migration.** Read-path scoping makes any stray cross-org attachment inert. The smoke records a data check (0 rows), run on app-dev too.

Rejected alternatives:
- A DB-level composite FK `(policy_id, organization_id)`: a schema change plus a backfill, for what the two code checks already cover.
- Silently dropping unknown ids: it hides typos and stale editor state.

## Plan: 2 slices

**Slice 1: read-path scoping.**
- **Files:** `permission-statements.repository.ts` (`findByPolicyIds(organizationId, ids)`); its 4 callers.
- **Tests:** `apps/api/src/__tests__/__integration__/services/permission-loadset.integration.test.ts`. A group in org A attached (inserted directly) to org B's custom policy contributes **no** statements to A's member's set, while A's own policy does.

**Slice 2: write-path validation.**
- **Files:** `permission-policies.repository.ts` (`findByIdsInOrg`); a new `apps/api/src/services/rbac-policy-refs.service.ts` (`assertAttachable`); `group.service.ts` and `role.service.ts` call it; `api-codes.constants.ts` (`RBAC_POLICY_UNKNOWN`); the `@openapi` 400 on the group and role POST/PUT routes.
- **Tests:** `group.router.integration.test.ts` and `role.router.integration.test.ts`. Create and update with `[""]`, an unknown uuid, another org's custom policy id and another org's `syspol:` id each give 400 `RBAC_POLICY_UNKNOWN`, with no group/role/attachment written (update leaves the prior attachments untouched). Duplicated valid ids are deduped. The valid in-org path is unchanged.
- **Runs:** `npm run test:integration -- --testPathPattern "group.router|role.router|permission-loadset|policy.router"` and `npm run test:unit` (apps/api).

## Smoke (manual, against your dev stack)

1. As the owner, `POST /api/groups` with `{"name":"s681","policyIds":[""]}` → **400** `RBAC_POLICY_UNKNOWN`; no group named `s681` exists afterwards.
2. The same with `"syspol:<another org id>:MemberAccess"` → **400** `RBAC_POLICY_UNKNOWN`, with the same message shape as step 1.
3. The same with an in-org policy id (e.g. `syspol:<own org>:MemberAccess`) → 200, and the group lists that policy. Delete it.
4. Repeat steps 1–3 against `POST /api/roles`, and `PUT` an existing group/role with a bad id → 400, its prior policies unchanged.
5. Access → Groups editor: create a group with a policy from the picker → it saves as before (the UI only offers in-org policies).
6. Data check, run locally **and on app-dev** (`portalops db psql --env app-dev`, read-only):
   `SELECT count(*) FROM policy_attachments a JOIN permission_policies p ON p.id = a.policy_id WHERE a.organization_id <> p.organization_id AND a.deleted IS NULL;` → 0.

## Out of scope

- Other attach-style payloads already check their ids: group membership (`assertMembers`, `group.service.ts:345`), a member's groups (`load` per id, `:369`), and grants (`RbacObjectResolver`). `policyIds` is the one unchecked reference, so no wider audit is needed here.
- Instance-scoped `field_mapping` statements in RBAC authoring (seen in #678: they can't be authored today). That's a feature question, not this bug.

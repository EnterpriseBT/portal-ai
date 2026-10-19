# Object provenance — Spec

This spec pins the contract for #641. Objects an agent creates in a portal session record which session made them, while `createdBy` stays the prompting user, and `created_by_system` stays reserved for platform seeds. It builds on [`OBJECT_PROVENANCE.discovery.md`](./OBJECT_PROVENANCE.discovery.md) and [#641](https://github.com/EnterpriseBT/portal-ai/issues/641).

## Key decisions (flag for review)

1. **The marker is a portal reference, `sourcePortalId: string | null`.** It is not a boolean column (discovery D1). The value is the portal whose session produced the object, written once at creation. *Amended in slice 4:* "session-generated" is derived by `isSessionGenerated(row)` from `@portalai/core` wherever it's shown, not shipped as a separate `sessionGenerated` payload field (see API payloads).
2. **Columns go on the six types a session produces today:** `connector_entities`, `field_mappings`, `entity_records`, `roles`, `permission_policies` and `groups`.
   - Pins reuse their existing `portal_results.portal_id` and get no new column.
   - Jobs keep `metadata.portalId`.
   - `CoreSchema` doesn't change (D2).
3. **The new columns have no foreign key.** Portals soft-delete, and provenance outlives the portal. Pins keep their existing FK.
4. **Provenance never affects ownership.** `createdBy` stays the caller everywhere. No permission check, `visibilityPredicate` or capability reads `sourcePortalId`.
5. **The session reaches tools as a closure argument** (D3). Entity, field-mapping and record tools gain a trailing `portalId: string | null`. The RBAC tools carry it on their audit context, which is already threaded through every RBAC create.
6. **Missing actors fall back to the job row's `createdBy`, never `"SYSTEM"`** (D5).
7. **A guard test enforces the system-principal allowlist** (D4). The allowlist only shrinks.
8. **The badge is a plain chip with no link** (discovery OQ2: a portal may be unreadable to another reader). It renders only when `sessionGenerated` is true.
9. **Records created before this ticket badge through `origin = 'portal'`.** `sessionGenerated` for a record is `sourcePortalId != null || origin === "portal"`. Editing a marked object keeps its marker (OQ1). Provisioned defaults stay system-owned (OQ3). Pins are all session output (OQ4), so they get no chip (*amended in slice 6*; see the web table).

## Scope

### In scope
- One migration adding the nullable column to six tables.
- Core model fields and API payload fields.
- Tool and RBAC-service threading, and bulk-transform's inserted records.
- The two processor actor fallbacks.
- The guard test.
- Web chips on the surfaces listed below.
- CLAUDE.md, the copilot mirror and the runbook guidance.

### Out of scope
- Columns on curated views, stations, tags, column definitions and entity groups, since no tool creates them.
- A list filter or index on provenance.
- A `ToolExecutionContext` refactor.
- Message-level provenance.
- Re-owning provisioned defaults.
- #640 definer semantics and #599 view ownership.

## Surface

### Migration: `apps/api/drizzle/0127_object-source-portal-id.sql`
```sql
ALTER TABLE "connector_entities"  ADD COLUMN "source_portal_id" text;
ALTER TABLE "field_mappings"      ADD COLUMN "source_portal_id" text;
ALTER TABLE "entity_records"      ADD COLUMN "source_portal_id" text;
ALTER TABLE "roles"               ADD COLUMN "source_portal_id" text;
ALTER TABLE "permission_policies" ADD COLUMN "source_portal_id" text;
ALTER TABLE "groups"              ADD COLUMN "source_portal_id" text;
```
The migration is generated with `npm run db:generate -- --name object-source-portal-id` and committed with its `meta/_journal.json` and `0127_snapshot.json` entries. Each change is a nullable add with no default, which is metadata-only in Postgres 11+ (including the large `entity_records`). There is no index and no backfill. `lint:migrations` passes, since the migration carries no destructive DDL.

### Drizzle tables (`apps/api/src/db/schema/`)
Each of `connector-entities.table.ts:17`, `field-mappings.table.ts:22`, `entity-records.table.ts:42`, `roles.table.ts:13`, `permission-policies.table.ts:12` and `groups.table.ts:12` gains:
```ts
/** #641: the portal whose agent session created this row; null otherwise. Provenance only — never read by authorization. */
sourcePortalId: text("source_portal_id"),
```
`zod.ts` derives from the tables, so it changes on its own. The `type-checks.ts` blocks (`:422`, `:446`, `:469`, `:840`, `:897`, `:915`) keep compiling once the core models gain the field.

### Core models (`packages/core/src/models/`)
- `ConnectorEntitySchema` (`connector-entity.model.ts:14`), `FieldMappingSchema` (`field-mapping.model.ts:14`), `EntityRecordSchema` (`entity-record.model.ts:19`), `PolicySchema` (`permission.model.ts:463`), `RoleSchema` (`:613`) and `GroupSchema` (`:651`) each gain:
  ```ts
  sourcePortalId: z.string().nullable().default(null),
  ```
  The `.default(null)` keeps every existing factory and `parse` site valid. This addresses the "required model field breaks the create path" hazard: the field is never required at a creation site.
- New, in `packages/core/src/models/provenance.model.ts`:
  ```ts
  /** #641: whether an object was produced in a portal (agent) session. Provenance only; never ownership. */
  export function isSessionGenerated(row: {
    sourcePortalId?: string | null;
    origin?: string;
  }): boolean;
  // true when sourcePortalId is a non-empty string, or origin === "portal" (records created before #641)
  ```
  It is exported from the models barrel.

### API payloads (`packages/core/src/contracts/`)
*Amended in slice 4.* The spec first added a derived `sessionGenerated: boolean` to every payload. Every route builds its response by hand behind an `as unknown as` cast, so a route that missed the field would still type-check. The payload therefore carries only the marker itself, and every reader derives the flag with the one shared `isSessionGenerated` helper.
- **Spread types** (connector entity, field mapping, record): the routes spread the full row, and `withCapabilities(XSchema)` spreads the model, so `sourcePortalId` (and a record's `origin`) reach GET, list and write responses with no route change.
- **RBAC views** (built by hand): `PolicyViewSchema` (`rbac-authoring.contract.ts:49`), `RoleViewSchema` (`:81`) and `GroupViewSchema` (`:114`) each gain `sourcePortalId: z.string().nullable()`.
  - It is set in `PolicyService.toView` and `GroupService.toView`.
  - The four inline role views in `role.service.ts` are folded into one `RoleService.toView`, so a fifth view can't miss the field.
- **Pins:** no change. Their existing `portalId` is the reference, and the web reads `isSessionGenerated({ sourcePortalId: pin.portalId })`.
- The OpenAPI components pick up the RBAC view field through their `z.toJSONSchema` registrations in `swagger.config.ts`.

### Tools and RBAC threading (`apps/api/src/`)
- **Tool signatures:**
  - `EntityRecordCreateTool.build(stationId, organizationId, userId, portalId: string | null)` (`tools/entity-record-create.tool.ts:60`) sets `sourcePortalId: portalId` beside `origin: "portal"` (`:160`).
  - `ConnectorEntityCreateTool.build(stationId, userId, portalId: string | null)` (`tools/connector-entity-create.tool.ts:48`) sets it on the `upsertByKey` insert only. An existing entity keeps its original provenance.
  - `FieldMappingCreateTool.build(stationId, organizationId, userId, portalId: string | null)` (`tools/field-mapping-create.tool.ts:84`) sets it at `:158`.
- **Registration:** `ToolService.buildAnalyticsTools` (`services/tools.service.ts:455`) passes `portalId ?? null` at `:753`, `:766` and `:778`.
- **RBAC audit context:**
  - `RbacAuditContext` (`services/policy.service.ts:36`) becomes `{ sourceIp: string | null; userAgent: string | null; sourcePortalId: string | null }`.
  - `AGENT_AUDIT` (`tools/rbac/rbac-tool.util.ts:18`) becomes `agentAudit(portalId: string | null): RbacAuditContext`. It returns `{ sourceIp: null, userAgent: "portal-agent", sourcePortalId: portalId }`.
  - `RoleCreateTool`, `PolicyCreateTool` and `GroupCreateTool` take `build(ctx: PermissionContext, portalId: string | null)` and pass `agentAudit(portalId)`. They are registered at `tools.service.ts:814–838`.
  - `RoleService.create` (`role.service.ts:231`), `GroupService.create` (`group.service.ts:163`) and `PolicyService.create` (`policy.service.ts:195`) write `sourcePortalId: audit.sourcePortalId` on the new row.
  - Their REST routes (`role.router.ts:98`, `group.router.ts:95`, `policy.router.ts:97`) build their audit context with `sourcePortalId: null`.
  - An update never writes the column.
- **Bulk transform:** records the job inserts into a target entity get `sourcePortalId` from `bullJob.data.portalId ?? null`, which the tool already puts in metadata (`transform-entity-records.tool.ts:729–742`). The value is threaded through the processor's existing `userId` options to the insert in `bulk-transform.service.ts`.
- **REST and other writers pass `null`:**
  - connector-entity, field-mapping and record POST and import (`connector-entity.router.ts:611`, `field-mapping.router.ts:529`, `entity-record.router.ts:869`, `:1106`)
  - `record-import.util.ts:124`
  - `layout-plan-commit.service.ts:276`
  - `demo-seed.service.ts`

  These need no code change, since the model default covers them.

### Processor actor fallback
- `bulk-transform.processor.ts:61–62` and `bulk-geocode.processor.ts:247` replace `?? "SYSTEM"` with a new `resolveJobActor(jobId: string, metadataUserId: string | undefined): Promise<string>` in `apps/api/src/queues/processors/job-actor.util.ts`. It returns `metadataUserId` when present. Otherwise it returns `(await DbService.repository.jobs.findById(jobId))?.createdBy`, and if the row is gone it throws `UnrecoverableError` naming the job.
- For geocode, this value is the cost-gate actor, not a `createdBy`. The rule is the same: a real principal, never a phantom one.

### Guard: `apps/api/src/__tests__/system-principal.guard.test.ts`
Modelled on `permission-copy.guard.test.ts`: the same `sourceFiles` walk over `apps/api/src` (skipping `__tests__`), a minimum-file-count sanity check, and an allowlist that only shrinks.
- **Rule 1, system principal:** a non-allowlisted file fails when it references `SystemUtilities.id.system` or a string literal `"SYSTEM"` used as a value (regex: `SystemUtilities\.id\.system|["']SYSTEM["']`). Allowlist `ALLOWED_SYSTEM: Array<{ file: string; reason: string }>`:
  - `services/seed.service.ts`, `services/demo-seed.service.ts`, `db/seed-org.ts`: platform and fixture seeds
  - `services/application.service.ts`: org provisioning and provisioned defaults, user rows
  - `services/seat.service.ts`, `services/tier-grant.service.ts`, `services/billing.service.ts`, `services/marketplace.service.ts`: identity and billing housekeeping
  - `services/wide-table-reconciler.service.ts`, `queues/processors/dissolve-precompute.processor.ts`: platform materializations
  - `services/permission-set.ts`: reads it for `created_by_system`
  - `utils/system.util.ts`: the definition

  Any further file that reads it today is found during implementation and added with its reason, or fixed.
- **Rule 2, session threading:** in `services/tools.service.ts`, every `.build(` of a tool class listed in `SESSION_CREATING_TOOLS = ["EntityRecordCreateTool", "ConnectorEntityCreateTool", "FieldMappingCreateTool", "RoleCreateTool", "PolicyCreateTool", "GroupCreateTool"]` passes a `portalId` argument. The check uses the TypeScript AST, like `invalid-request-code.guard.test.ts`.
- **Rule 3, the list stays honest:** every allowlisted file still matches (so the list only shrinks), and every `SESSION_CREATING_TOOLS` entry is a class that exists.

### Web (`apps/web/src/`)
The new `components/SessionGeneratedChip.component.tsx` is pure UI: `SessionGeneratedChipUI({ size?: "small" | "medium" })` renders `<Chip label="Created in a portal session" … />`. It is used on these surfaces:

| Type | Detail | List row |
|---|---|---|
| Entity | `views/EntityDetail.view.tsx:369` `MetadataList` item `{ label: "Provenance", value: <SessionGeneratedChipUI/>, variant: "chip", hidden: !entity.sessionGenerated }` | `components/ConnectorEntity.component.tsx:111` card |
| Record | `components/EntityRecordMetadata.component.tsx:29`, the same item beside "Origin" (`:41`) | none (the data table is cell data; not this ticket) |
| Field mapping | none (no detail page) | `components/ConnectorEntity.component.tsx:79` `FieldMappingTableUI` row |
| Role / policy / group | none (editor dialogs only) | `modules/AccessAuthoring/AccessAuthoring.component.tsx:144`, beside the `system` chip; `Row` (`:46`) gains `sessionGenerated` |
| Pin | none (*amended in slice 6:* every pin is agent output, and deleting its portal nulls `portalId`, so a badge would carry no information and vanish with the portal; the detail page already shows "Source: Portal deleted") | none |

### Docs
- **`CLAUDE.md`:** a new `### Ownership & provenance (#641)` under `## Database Schema Workflow (Dual-Schema)` (after `:414`). It defines three categories:
  - **platform seed / provisioned default:** `createdBy = SystemUtilities.id.system`; members read it via `created_by_system`; only allowlisted files
  - **session-generated:** `createdBy = caller`, `sourcePortalId = portalId`; a new session-creating tool joins `SESSION_CREATING_TOOLS`
  - **user-created**

  It also states that provenance never feeds authorization. The same paragraph goes into `.github/copilot-instructions.md` under `## Database (Dual-Schema)` (`:51`).
- **`docs/PROD_PROVISIONING.runbook.md:266`:** the system-actor list becomes "platform seeds and org-provisioned defaults, billing and identity housekeeping, wide-table materializations. Never an object a user or an agent session created."

## Migration
`0127_object-source-portal-id`, as above. It is forward-only and expand-only. Rollback is a new forward migration if ever needed; the column is inert to authorization.

## Seed
No seed change. The system seeds keep `SystemUtilities.id.system`, and no per-org seeded row is added, so no backfill-coverage marker is needed.

## TDD test plan
Run from each package: `npm run test:unit` / `npm run test:integration` (never raw jest).

### core: `packages/core/src/__tests__/models/provenance.model.test.ts` (new)
- `isSessionGenerated` cases:
  - a portal id → true
  - null → false
  - `""` → false
  - `origin: "portal"` with no id → true
  - `origin: "sync"` → false
- The six schemas parse a row without `sourcePortalId` to `null`, and keep a provided id.
- 8 cases.

### api unit
- `__tests__/system-principal.guard.test.ts` (new):
  - no offenders
  - the allowlist is still live
  - a fixture source with `"SYSTEM"` as `createdBy` fails
  - a fixture `.build(` of a session tool without `portalId` fails
  - the file-count sanity check
  - 6 cases
- `__tests__/queues/processors/job-actor.util.test.ts` (new):
  - the metadata user wins
  - falls back to the row's `createdBy`
  - a missing row throws `UnrecoverableError`
  - 3 cases
- `__tests__/tools/connector-entity-create.tool.test.ts`, `entity-record-create.tool.test.ts` and `field-mapping-create.tool.test.ts` gain one case each: the `portalId` passed to `build` lands as `sourcePortalId`, and `createdBy` is still the caller. That's 3 cases. The RBAC tools have no unit suites, so they're covered by the integration cases through `agentAudit`.

### api integration
- `__tests__/__integration__/routes/object-provenance.integration.test.ts` (new):
  - For each spread type (entity, field mapping, record): a row with `source_portal_id` set reads back `sourcePortalId` on GET and list; a REST-created row reads `null`. (3 cases)
  - RBAC: a role, a policy and a group created through the services with `agentAudit("portal-1")` store and list `sourcePortalId: "portal-1"`, owned by the caller; a REST create stores and lists `null`; an update keeps the marker. (10 cases)
  - The `origin = 'portal'` fallback is covered by core's `isSessionGenerated` unit cases. Pins need no API case, since `portalId` is unchanged.
  - *Amended:* ownership is asserted as `createdBy = caller` on every created row (above, and in the tool unit cases). "Authorization never reads `sourcePortalId`" is held by the slice-5 guard as a source check over the authorization files, not by per-type capability comparisons.
  - An update to a marked entity keeps its `sourcePortalId`. (1 case)
  - 18 cases.
- `__tests__/__integration__/queues/bulk-transform…` (the existing suite) gains: inserted target records carry the job's `portalId`; with `userId` absent from the metadata, audit columns stamp the job row's `createdBy`, not `"SYSTEM"`. 2 cases.

### web unit
- `__tests__/SessionGeneratedChip.test.tsx` (new): renders the label. 1 case.
- `EntityRecordMetadata`, `ConnectorEntity` (card and field-mapping row), `AccessAuthoringUI` row, and the `EntityDetailViewUI` tests each gain: the chip shows when `sessionGenerated` is true and is absent when false. About 7 cases.

**Totals ≈ 48 cases.**

## Acceptance criteria
- [ ] A connector entity, field mapping, record, role, policy or group the agent creates in a portal is owned by the prompting user (`createdBy`, capabilities, sharing, `created_by_caller`), exactly like a hand-created twin.
- [ ] That object's API payload carries `sourcePortalId` = the portal's id. A REST-created object carries `null`.
- [ ] `isSessionGenerated` is true for those objects, and for records the agent created before this ticket (`origin = 'portal'`).
- [ ] No permission check, visibility predicate or capability reads `sourcePortalId`.
- [ ] `created_by_system` matches only rows written by the allowlisted seed, provisioning, housekeeping and materialization paths. CI fails a new writer outside the list.
- [ ] No job stamps `"SYSTEM"` as an actor. A job missing `userId` in its metadata uses its row's `createdBy`.
- [ ] The "Created in a portal session" chip shows on the surfaces in the web table, for anyone who can read the object, and only when `sessionGenerated` is true.
- [ ] CLAUDE.md, the copilot mirror and the runbook describe the three categories.

## Risks & rollback
- **A missed RBAC view drops the fields.** The hand-built role views are folded into one `toView`, and the integration cases assert the fields on list responses.
- **The guard regex hits a legitimate `"SYSTEM"`** (e.g. a log label). The fix is a code change or an allowlist entry with a reason. The guard can't silently pass a new writer.
- **A required-field ripple to web and site fixtures.** `sourcePortalId` is required on the model output and RBAC view types, so typed fixtures in web stories and tests must add it. This surfaced in slices 1 and 4. Run the full root `npm run build` / `type-check` before pushing (per memory), not per-package only.
- **Fail mode:** provenance is fail-open by nature. A missing `portalId` writes `NULL`, so the object is just not badged. Ownership is never at risk, because authorization never reads the field.
- **Rollback:** revert the PR. The columns stay (expand-only) and are harmless.

## Files touched
- **New:**
  - `apps/api/drizzle/0127_object-source-portal-id.sql` (+ meta)
  - `packages/core/src/models/provenance.model.ts`
  - `apps/api/src/queues/processors/job-actor.util.ts`
  - `apps/api/src/__tests__/system-principal.guard.test.ts`
  - `apps/web/src/components/SessionGeneratedChip.component.tsx`
  - the test files named above
- **Edit, api schema:** the six `*.table.ts` files
- **Edit, core:**
  - `connector-entity.model.ts`, `field-mapping.model.ts`, `entity-record.model.ts`, `permission.model.ts`, `models/index.ts`
  - `connector-entity.contract.ts`, `field-mapping.contract.ts`, `entity-record.contract.ts`, `rbac-authoring.contract.ts`, `portal.contract.ts`
- **Edit, api:**
  - tools: `entity-record-create.tool.ts`, `connector-entity-create.tool.ts`, `field-mapping-create.tool.ts`, `tools/rbac/{role,policy,group}.tool.ts`, `tools/rbac/rbac-tool.util.ts`
  - services: `tools.service.ts`, `policy.service.ts`, `role.service.ts`, `group.service.ts`, `bulk-transform.service.ts`
  - processors: `bulk-transform.processor.ts`, `bulk-geocode.processor.ts`
  - routes: `connector-entity.router.ts`, `field-mapping.router.ts`, `entity-record.router.ts`, `portal-results.router.ts`, `role.router.ts`, `group.router.ts`, `policy.router.ts`
- **Edit, web:**
  - `views/EntityDetail.view.tsx`
  - `components/EntityRecordMetadata.component.tsx`, `components/ConnectorEntity.component.tsx`
  - `modules/AccessAuthoring/AccessAuthoring.component.tsx`
- **Edit, docs:** `CLAUDE.md`, `.github/copilot-instructions.md`, `docs/PROD_PROVISIONING.runbook.md`

## Next step
`docs/OBJECT_PROVENANCE.plan.md` sequences this into about six TDD slices on this branch:
1. migration, tables and core models
2. payload fields (spread types, RBAC views, pins)
3. tool and RBAC threading, plus bulk-transform records
4. the job-actor fallback
5. the guard
6. web chips and docs

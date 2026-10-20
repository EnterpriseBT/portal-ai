# Member column-definition read — Condensed design (#832)

**Issue:** [EnterpriseBT/portal-ai#832](https://github.com/EnterpriseBT/portal-ai/issues/832) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The seeded `MemberAccess` policy gives members no read on `column_definition`, so every catalog surface is empty for them. The agent's `station_context` omits `columnDefinitions`, so `field_mapping_create` has no id to use even on an entity the member owns. #630 chose this on purpose (the catalog page was admin-only, "Decision A"), but the agent's write path depends on the catalog. API only (seed, one backfill migration, two catalog surfaces).

## Current shape

| Piece | Location | Note |
|---|---|---|
| Member policy | `apps/api/src/services/seed.service.ts` `MemberAccess` | no `column_definition` statement; ids `sysstmt:<org>:MemberAccess:<effect>:<verb>:<type>:<cond>` (`:670`) |
| Backfill template | `apps/api/drizzle/0111_backfill-member-data-delete.sql` | INSERT … SELECT over live MemberAccess policies, deterministic ids, `ON CONFLICT DO NOTHING` |
| List route | `apps/api/src/routes/column-definition.router.ts:174–182` | already filters by `visibilityPredicate("column_definition")` |
| By-id reads | same file `:315`, `:942`, `:1053` | `can("resource.read", …)` with the row's creator |
| Agent catalog | `apps/api/src/tools/station-context.tool.ts:332–351` | gated on `canPerformAny(read)`, then returns **every** org definition |
| SQL catalog | `apps/api/src/services/portal-sql.service.ts:1057` | `_meta_column_catalog`, gated on `canPerformAny(read)`, raw org-wide SELECT; its comment says class-wide (admin) only |
| Mapping create / update | `apps/api/src/routes/field-mapping.router.ts:469`, `:731` | load the column definition, checking only that it's in the org; no read check |
| Agent mapping create | `apps/api/src/tools/field-mapping-create.tool.ts:147` | loads each item's column definition; the gate checks only the entity (`TOOL_AUTHORIZATION.field_mapping_create`, `parts`) |

## Decision — members read the system catalog

- **A. `allow read column_definition created_by_system`** in `MemberAccess`, backfilled for existing orgs. Members read the platform-seeded catalog the way they read other system-provisioned objects. A definition an admin creates stays readable only through a grant.
- **B. Unconditional `read column_definition`.** Every member sees every definition, including org-created ones nobody granted. That's an implicit grant, and #829 ruled those out.
- **C. Leave it, and expose the catalog to the agent some other way.** That would be a heuristic around the permission engine.

**Decision: A.** It adds only a read, on system objects, which members already read elsewhere. Page visibility doesn't change: the column-definition pages aren't in `MEMBER_VIEW_PAGE_IDS`, so members still have no nav entry.

**Shape:**
- Seed: `MemberAccess` gains `{ effect: "allow", verb: "read", resourceType: "column_definition", condition: "created_by_system" }`.
- Migration `0129_backfill-member-column-definition-read` (`npm run db:generate -- --custom --name backfill-member-column-definition-read`), on the 0111 pattern, with id `sysstmt:<org>:MemberAccess:allow:read:column_definition:created_by_system`. The SQL, `meta/_journal.json` and the snapshot are committed together.
- **`station_context` filters per row:** it returns only the definitions `set.can("resource.read", { type: "column_definition", id, createdBy })` allows. A conditional grant then can't expose org-created definitions.
- **`_meta_column_catalog` keeps its stated admin rule:** the gate becomes the class-level `set.can("resource.read", { type: "column_definition" })` (unconditional grants only), so the new conditional statement doesn't widen it. Members map through the agent's `station_context`, not raw SQL.
- **A mapping's column definition is a reference, so it needs read** (unreadable == absent):
  - `POST /api/field-mappings` → `404 COLUMN_DEFINITION_NOT_FOUND` unless the definition is in the org **and** readable;
  - `PATCH` applies the same check only when `columnDefinitionId` changes, since the editor resends the stored id on every save;
  - the agent's `field_mapping_create` checks it in the permission gate, through a new `parts` descriptor field `references: [{ resourceType: "column_definition", paths: ["items[].columnDefinitionId"] }]`. An unreadable definition answers `TOOL_TARGET_NOT_FOUND` and nothing is written;
  - `ParentAccessService.firstRefusal` gains a lean `column_definition` lookup (`columnDefinitions.findAuthRows`);
  - `field_mapping_update` takes no `columnDefinitionId`, so it has nothing to check.

## Plan — one slice

**Files**
- Edit: `apps/api/src/services/seed.service.ts`: the new MemberAccess statement.
- New: `apps/api/drizzle/0129_backfill-member-column-definition-read.sql` + journal + snapshot.
- Edit: `apps/api/src/tools/station-context.tool.ts`: per-row read filter.
- Edit: `apps/api/src/services/portal-sql.service.ts`: class-level gate for `_meta_column_catalog`.
- Edit: `apps/api/src/routes/field-mapping.router.ts`: read check on the column definition (create; update when it changes).
- Edit: `packages/core/src/models/tool-capability.model.ts` (`references`, `parts` only), `packages/core/src/registries/builtin-toolpacks.ts` (`field_mapping_create`), `apps/api/src/services/permission-gate.service.ts`, `apps/api/src/services/parent-access.service.ts`, `apps/api/src/db/repositories/column-definitions.repository.ts` (`findAuthRows`).

**Tests** (`npm run test:unit` / `npm run test:integration` from `apps/api`)
- `src/__tests__/tools/station-context.tool.test.ts`: a member gets the system definitions and not an admin-created one; an owner gets all.
- `src/__tests__/__integration__/services/rbac-seed.integration.test.ts`: statement count 36 → 37.
- New `src/__tests__/__integration__/db/member-column-definition-read-backfill.integration.test.ts`: the statement is removed, 0129 is applied and the row is back; idempotent on a second run.
- `src/__tests__/__integration__/routes/column-definition.router.integration.test.ts`: a member lists system definitions only, and 404s on an admin-created one.
- `src/__tests__/__integration__/services/portal-sql.service.integration.test.ts`: a member session still has no `_meta_column_catalog`.
- `src/__tests__/__integration__/routes/field-mapping.router.integration.test.ts`:
  - a member creating a mapping on their own entity with an admin-created (unreadable) definition → 404 `COLUMN_DEFINITION_NOT_FOUND`, and with a system definition → 201;
  - an update switching to an unreadable definition → 404, while resending the stored one passes.
- `packages/core/src/__tests__/models/tool-capability.model.test.ts`: `references` is allowed on `parts` only. `src/__tests__/services/permission-gate.service.test.ts`: an unreadable reference → `TOOL_TARGET_NOT_FOUND`, and the tool doesn't run.

## Smoke (manual, against your dev stack)

1. `cd apps/api && npm run db:migrate`, which applies 0129. As **member**, `GET /api/column-definitions?limit=100`: the 29 system definitions, and none an admin created.
2. As **member** in a portal on a station reaching the member's own entity: "Add a field mapping for sourceField email to <my entity>". The agent finds `columnDefinitionId`s in `station_context` and the mapping is created.
3. As **owner**, create a column definition. As **member**:
   - it isn't in the list or in `station_context`, and `GET /api/column-definitions/<id>` → 404;
   - `POST /api/field-mappings` on the member's own entity with that id → 404 `COLUMN_DEFINITION_NOT_FOUND`;
   - `field_mapping_create` with that id in the portal → `TOOL_TARGET_NOT_FOUND`.
4. As **member**, the sidebar still has no Column Definitions entry.

## Out of scope

- **Members reading admin-created definitions.** That's a grant decision per org.

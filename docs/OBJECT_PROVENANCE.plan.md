# Object provenance — Plan

**This plan implements #641 test-first: a `sourcePortalId` marker on the six types an agent session produces, threaded from the tools and kept out of authorization, plus a derived `sessionGenerated` on payloads and a "Created in a portal session" chip. A guard keeps `created_by_system` reserved for platform seeds.**

- Spec: `docs/OBJECT_PROVENANCE.spec.md`
- Discovery: `docs/OBJECT_PROVENANCE.discovery.md`
- Issue: #641 (Security & Enterprise Readiness epic #578)
- Builds on: #599 (curated views) and #640 (pins), both merged.

There are 6 slices. Each sits behind a green test suite and leaves the repo compilable. They land as **commits on `feat/641-object-provenance`**: one feature, one PR (#823), per `CLAUDE.md` → "Phase = commit, not PR".

Run tests from each package (never invoke jest directly):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice:
1. Write failing tests.
2. Make the smallest change that greens them.
3. Do a focused run (`--testPathPattern`).
4. Run `npm run lint && npm run type-check` at the boundary. Slices 1 and 4 change core types, so they run the **root** `npm run build && npm run type-check`.
5. Move to the next slice.

Sequencing rationale:
1. **Schema and models first.** Every later slice reads or writes the column.
2. **The job-actor fallback.** It's a leaf with no dependency on the column, and it removes a `"SYSTEM"` literal before the guard can forbid it.
3. **Write paths.** Tools, RBAC services and bulk-transform start storing the value. They are asserted at the row level, because payloads don't carry it yet.
4. **Read paths.** Payload fields, RBAC views and pins. This is the contract change web consumes.
5. **The guard.** It can only pass once slice 2 removed the fallbacks and slice 3 threaded `portalId` into every session tool.
6. **Web chips and docs.** They consume slice 4's fields, and the docs describe the finished rule.

---

## Slice 1 — Column, tables and core models

This slice adds the nullable `source_portal_id` to six tables, `sourcePortalId` to six core models, and the `isSessionGenerated` helper. Nothing writes or reads the column yet.

**Files**
- New:
  - `apps/api/drizzle/0127_object-source-portal-id.sql` and its `meta/_journal.json` and `0127_snapshot.json` entries
  - `packages/core/src/models/provenance.model.ts`
  - `packages/core/src/__tests__/models/provenance.model.test.ts`
- Edit:
  - the six `*.table.ts` files (`connector-entities`, `field-mappings`, `entity-records`, `roles`, `permission-policies`, `groups`)
  - the core models (`connector-entity.model.ts`, `field-mapping.model.ts`, `entity-record.model.ts`, `permission.model.ts`)
  - `packages/core/src/models/index.ts`

**Steps**
1. **Tests (spec: core, 8 cases).**
   - `isSessionGenerated`: an id, null, `""`, `origin: "portal"`, `origin: "sync"`.
   - The six schemas default a missing `sourcePortalId` to `null` and keep a given one.
   - Run them; they fail.
2. **Implement.**
   - Add the model fields with `.nullable().default(null)` and add the helper.
   - Add the table columns.
   - Run `npm run db:generate -- --name object-source-portal-id` from `apps/api`, then `npm run db:migrate`.
   - Check that the generated SQL is exactly the six `ADD COLUMN … text` statements.
   - Green.
3. Run `npm run lint:migrations`, then the root build and type-check, since `type-checks.ts` must still hold both directions.

**Done when:** the core cases pass, the migration applies on the local DB, `lint:migrations` is clean, and the root build is green. The column is inert.

**Risk:** a required-field ripple. The default means no creation site needs to change; the root build proves it.

---

## Slice 2 — Job actor fallback

`resolveJobActor` replaces the `"SYSTEM"` literals in the bulk-transform and bulk-geocode processors.

**Files**
- New:
  - `apps/api/src/queues/processors/job-actor.util.ts`
  - `apps/api/src/__tests__/queues/processors/job-actor.util.test.ts`
- Edit: `bulk-transform.processor.ts` (`:61–62`), `bulk-geocode.processor.ts` (`:247`)

**Steps**
1. **Tests.**
   - Spec, api unit `job-actor.util`, 3 cases: the metadata user wins; it falls back to the row's `createdBy`; a missing row throws `UnrecoverableError`.
   - The existing bulk-transform integration suite gains the **actor** case: with no `userId` in the metadata, audit columns stamp the job row's `createdBy`.
   - Run them; they fail.
2. **Implement** the util, and call it from both processors in place of `?? "SYSTEM"`. Green.
3. Lint and type-check (api).

**Done when:** the 3 unit cases and the actor integration case pass, and `grep '"SYSTEM"'` no longer matches either processor.

**Risk:** geocode's actor goes to the cost gate. The value is only ever a real principal, so cost attribution improves and nothing is charged differently.

---

## Slice 3 — Write paths: tools, RBAC services, bulk-transform records

Session-produced rows now store `sourcePortalId`, and REST-created rows store `null`. `createdBy` is unchanged.

**Files**
- Edit, tools:
  - `entity-record-create.tool.ts`, `connector-entity-create.tool.ts`, `field-mapping-create.tool.ts`: a trailing `portalId: string | null` on `build`, set on the insert
  - `tools/rbac/rbac-tool.util.ts`: `AGENT_AUDIT` becomes `agentAudit(portalId)`
  - `tools/rbac/{role,policy,group}.tool.ts`: `build(ctx, portalId)`
- Edit, services:
  - `tools.service.ts`: pass `portalId ?? null` at `:753/:766/:778` and the rbac pack `:814–838`
  - `policy.service.ts`: `RbacAuditContext` gains `sourcePortalId`, and `create` writes it
  - `role.service.ts`, `group.service.ts`: `create` writes `audit.sourcePortalId`
  - `bulk-transform.service.ts`: inserted target records carry the job's `portalId`
- Edit, routes:
  - `bulk-transform.processor.ts`: thread `bullJob.data.portalId`
  - `role.router.ts`, `group.router.ts`, `policy.router.ts`: audit context with `sourcePortalId: null`

**Steps**
1. **Tests.**
   - Spec, api unit, 3 cases: each create-tool test asserts that the `portalId` given to `build` lands as `sourcePortalId`, and `createdBy` is still the caller.
   - Spec ownership cases, 3, in `object-provenance.integration.test.ts`, asserting **stored rows**: a member's tool-created field mapping and role have `createdBy = member`, the same capabilities as a REST twin, and the same `visibilityPredicate` exclusion.
   - An RBAC row-level check: `RoleService.create` / `PolicyService.create` / `GroupService.create` with `agentAudit("p1")` store `source_portal_id = 'p1'`, and a REST create stores `NULL`.
   - "An update keeps `sourcePortalId`."
   - The bulk-transform **portalId** case.
   - Run them; they fail.
2. **Implement** the signatures and writes above. Green.
3. Lint and type-check (api).

**Done when:** the tool, ownership and RBAC row cases and the bulk-transform portalId case pass. Payloads don't expose the field yet; that's slice 4.

**Risk:** `connector-entity-create` writes through `upsertByKey`. Set the column on insert only, so an existing entity keeps its original provenance (the spec says so; assert it).

---

## Slice 4 — Read paths: payloads, RBAC views, pins

Responses carry `sourcePortalId`. Spread types already do; the RBAC views gain it. *Amended:* no separate `sessionGenerated` field; readers use `isSessionGenerated` (spec, API payloads). This is the contract change.

**Files**
- Edit, contracts: `connector-entity.contract.ts`, `field-mapping.contract.ts`, `entity-record.contract.ts`, `rbac-authoring.contract.ts`, `portal.contract.ts`
- Edit, routes: `connector-entity.router.ts`, `field-mapping.router.ts`, `entity-record.router.ts`, `portal-results.router.ts`
- Edit, services: `policy.service.ts` / `group.service.ts` `toView`; `role.service.ts` folds its four inline views into one `toView`
- Edit, web and site: typed fixtures and stories that build these payloads gain `sourcePortalId`

**Steps**
1. **Tests (spec, api integration `object-provenance`, the payload cases).**
   - Spread types on GET and list: 6 cases.
   - The `origin = 'portal'` record with a null id: 1 case.
   - RBAC list views with `agentAudit` versus REST: 6 cases.
   - Pins: 1 case.
   - Run them; they fail.
2. **Implement** the contract fields, `isSessionGenerated` in the routes and views, and the role `toView` fold. Green.
3. Run the **root** `npm run build && npm run type-check`, plus the web and site unit suites touched by fixture edits.

**Done when:** all 18 `object-provenance` integration cases (including slice 3's) pass and the root build is green. OpenAPI shows the fields through the registered components.

**Risk:** the required response field ripples to web and site fixtures. Per memory, per-package type-check misses this, so the root build is the gate.

---

## Slice 5 — System-principal guard

CI now enforces the allowlist and session-tool threading.

**Files**
- New: `apps/api/src/__tests__/system-principal.guard.test.ts`

**Steps**
1. **Tests (spec, api unit guard, 6 cases).**
   - No offenders.
   - The allowlist is live.
   - The `"SYSTEM"`-as-`createdBy` fixture fails.
   - A session-tool `.build(` without `portalId` fails.
   - `SESSION_CREATING_TOOLS` classes exist.
   - The file-count sanity check.
2. **Implement** the guard. Then run it against the real tree. Each hit outside the spec's list is either fixed (it's a real writer) or added with a reason. Record any additions in the PR body. Green.
3. Lint and type-check (api).

**Done when:** the guard is green on the tree, and fails on both fixtures.

**Risk:** the `"SYSTEM"` literal regex may hit a non-principal string. Prefer renaming that literal to widening the allowlist.

---

## Slice 6 — Web chips and docs

The "Created in a portal session" chip goes on the spec's surfaces, and the ownership and provenance guidance lands.

**Files**
- New:
  - `apps/web/src/components/SessionGeneratedChip.component.tsx`
  - `apps/web/src/__tests__/SessionGeneratedChip.test.tsx`
- Edit, web:
  - `views/EntityDetail.view.tsx`, `views/PinnedResultDetail.view.tsx`
  - `components/EntityRecordMetadata.component.tsx`, `components/ConnectorEntity.component.tsx` (card and `FieldMappingTableUI` row), `components/PinnedResultsList.component.tsx`
  - `modules/AccessAuthoring/AccessAuthoring.component.tsx` (`Row.sessionGenerated` and the chip)
- Edit, docs: `CLAUDE.md` (`### Ownership & provenance (#641)`), `.github/copilot-instructions.md`, `docs/PROD_PROVISIONING.runbook.md:266`

**Steps**
1. **Tests (spec, web, about 8 cases).** The chip renders its label. Each surface's UI test shows the chip when `sessionGenerated` is true and omits it when false. Run them; they fail.
2. **Implement** the chip and wire it through the pure-UI props. Containers already pass the payload rows. Write the docs. Green.
3. Run `npm run lint && npm run type-check` (web), `format`, and `lint:doc-pointers`.

**Done when:** the web cases pass, and the docs name the three categories, the allowlist and `SESSION_CREATING_TOOLS`.

**Risk:** none beyond the Component File Policy. The chip is single-component pure UI; no new container.

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | Column ×6, model fields, `isSessionGenerated` | core unit, `lint:migrations`, root build |
| 2 | `resolveJobActor`, no `"SYSTEM"` in processors | api unit + bulk-transform actor case |
| 3 | Tools / RBAC / bulk-transform store `sourcePortalId` | tool unit, ownership + RBAC row integration |
| 4 | Payload `sourcePortalId` on RBAC views (spread types already carry it) | provenance integration cases, root build |
| 5 | System-principal guard | guard green on tree, red on fixtures |
| 6 | Chips + CLAUDE.md / mirror / runbook | web unit, lint, doc pointers |

## Cross-slice notes

- **Migration:** commit the `.sql`, `_journal.json` and snapshot together, or CI's fresh DB skips it. The dev stack doesn't migrate on its own, so run `db:migrate` locally after slice 1.
- **The `object-provenance.integration.test.ts` file grows across slices 3 and 4.** Slice 3 asserts rows through repositories, and slice 4 adds the payload assertions. No test is written to fail across a boundary.
- **Core changes need rebuilt dist** before the api and web consume them (`npm run build` at root). `npx portalops/portalai` aren't involved.
- **Docs-sync:** CLAUDE.md and its copilot mirror change together in slice 6. The tool descriptions (`builtin-toolpacks.ts` mirror, `system.prompt.ts`) don't change, since the tools' agent-facing contract is unchanged.
- **Smoke and adversarial** follow implementation, per the merge gate. The smoke needs a portal session that runs `create_entity` / `role_create` against the dev stack.

## Next step

Implementation begins on this branch with slice 1, tests first, once discovery, spec and plan are confirmed.

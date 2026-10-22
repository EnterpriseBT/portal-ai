# View-management toolpack — Plan

**TDD-sequenced implementation of the `view_management` toolpack. The order is: extract `CuratedViewService` from the views router, add key-based column resolution and session provenance, write the six tool classes against the service, register and wire the pack, share `member_list` into it, and prove the whole path end-to-end through the real gate stack.**

Spec: `docs/VIEW_MANAGEMENT_TOOLPACK.spec.md`. Discovery: `docs/VIEW_MANAGEMENT_TOOLPACK.discovery.md`. Issue: #645 (epic #578). Builds on shipped #599 (curated views), #629 (rbac_management + catch-403 gate), #641 (provenance), #644 (SQL filters), #802 (delete cascade), #829 (objects and parts).

Seven slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/645-view-management-toolpack` / PR #844**: one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package, focused on touched files (never invoke jest directly):

```bash
cd apps/api && npm run test:unit -- --testPathPattern <file>
cd apps/api && npm run test:integration -- --testPathPattern <file>
cd packages/core && npm run test:unit -- --testPathPattern <file>
cd apps/web && npm run test:unit -- --testPathPattern <file>
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice. Any slice touching `packages/core` rebuilds core and runs the root `npm run build` before its commit (a core change ripples into web/site typed fixtures).

Sequencing rationale:

- **Slice 1** is the riskiest change (500+ router lines move) and every later slice calls the service, so it goes first, with the unchanged router suite as its net.
- **Slice 2** adds `columnKeys`, a pure service extension with no tool yet.
- **Slice 3** adds provenance (migration + model + chip) before any tool writes `sourcePortalId`.
- **Slice 4** writes the tool classes, unit-tested against a mocked service and **not yet registered**. They depend only on slices 1–3.
- **Slice 5** registers and wires the pack. It must be atomic: adding the slug forces a `PACK_PROMPT_SECTIONS` entry (`Record<BuiltinToolpackSlug,…>`), a build block (the "every pack builds ≥1 tool" guard) and `BUILTIN_TOOL_NAMES` parity at once.
- **Slice 6** shares `member_list`, the one registry-invariant change, isolated so it's reviewable alone.
- **Slice 7** is the end-to-end integration suite through `buildAnalyticsTools`. It needs every earlier slice, member lookup included.

---

## Slice 1 — Extract `CuratedViewService`

Create, update, get, list and delete logic moves out of `curated-view.router.ts` into a service that takes a `PermissionContext`. The router keeps parsing and responding. `get` gains `columns`.

**Files**

- New: `apps/api/src/services/curated-view.service.ts`. It holds `list`/`get`/`create`/`update`/`delete` plus the moved helpers: `validateFilter`, `fieldMappingCreators`, `assertNoDuplicates`, `sameIdSet`, `assertProjection`, `assertEntityReadable`, `canonicalJson`, and `SORTABLE_COLUMNS`.
- Edit: `apps/api/src/routes/curated-view.router.ts`. List `:290`, get `:442`, create `:527`, update `:694` and delete `:885` become safeParse → service → `HttpService.success`. The filter-sql preview/suggest and attach routes import any helper they still need from the service. Fix the stale "self-exposure" `@openapi` text at `:518`, and document `columns` on the get response.
- Edit: `packages/core/src/contracts/curated-view.contract.ts`. Add `columns: { fieldMappingId, key: string | null }[]` to the get payload schema, and export `oneFilterMode`.

**Steps**

1. **Tests (spec: router integration, 2 new cases).** In `__integration__/routes/curated-view.router.integration.test.ts`, add "get returns `columns` with keys" and "a deleted projected mapping's key is null". Run; fail.
2. **Implement.** Do a mechanical move first: copy the bodies into the service, swap `req.application!.metadata` for `ctx` and `next(new ApiError…)` for `throw`, and keep every check's order and transaction boundary. Then point the router at the service and add `columns` to `get`. Green.
3. Run the **entire** router integration file plus `curated-view-delete.service.integration.test.ts` and `curated-views-filter-mode.integration.test.ts`, all unchanged. Lint + type-check, then the root build.

**Done when:** the unchanged router suite and the 2 new cases are green, and the router no longer contains any of the moved helpers.

**Risk:** a `return next(...)` that becomes a `throw` inside a `.catch` that rewraps non-`ApiError`s. Keep each `.catch(… if (error instanceof ApiError) throw error …)` exactly as it was.

---

## Slice 2 — `columnKeys` resolution

**Files**

- Edit: `apps/api/src/services/curated-view.service.ts`. Add the `CuratedViewCreateInput` / `CuratedViewUpdateInput` types and a private `resolveColumnKeys`, called after the entity read check (create) or after `loadForVerb(...,"write")` (update).
- New: `apps/api/src/__tests__/__integration__/services/curated-view.service.integration.test.ts`.

**Steps**

1. **Tests (spec: service integration, the 5 column cases).**
   - keys resolve in order;
   - an unknown key → 400 naming it;
   - a duplicate key → 400;
   - `columnKeys` + `fieldMappingIds` → 400;
   - an unknown key on an **unreadable** entity → 404 `CONNECTOR_ENTITY_NOT_FOUND`, not the key error.

   Run; fail.
2. **Implement** `resolveColumnKeys` against `fieldMappings.findByConnectorEntityId` (`normalizedKey` → id) and feed the result into `assertProjection`. Green.
3. Lint + type-check.

**Done when:** the 5 cases pass and the router (which never sends `columnKeys`) is unaffected.

---

## Slice 3 — Session provenance on curated views

**Files**

- Edit: `packages/core/src/models/curated-view.model.ts`. Add `sourcePortalId: SourcePortalIdSchema`.
- Edit: `apps/api/src/db/schema/curated-views.table.ts`. Add `sourcePortalId: text("source_portal_id")` with the #641 JSDoc.
- New: `apps/api/drizzle/0131_add-curated-view-source-portal-id.sql` + `meta/_journal.json` + snapshot, via `npm run db:generate -- --name add-curated-view-source-portal-id`.
- Edit: `apps/api/src/services/curated-view.service.ts`. `create` takes `opts.sourcePortalId`.
- Edit: `apps/web/src/views/CuratedViews.view.tsx` and `CuratedViewDetail.view.tsx`. Render `SessionGeneratedChipUI` when `isSessionGenerated(view)`, as `EntityDetail.view.tsx` does.

**Steps**

1. **Tests.**
   - Service integration: `sourcePortalId` is stored from `create` opts and is null from the route (2 cases).
   - `apps/web/src/__tests__/CuratedViewsView.test.tsx` and `CuratedViewDetailView.test.tsx`: the chip shows when set and is absent otherwise (4 cases).

   Run; fail.
2. **Implement.** Generate and apply the migration (`npm run db:migrate`), then add the model and table fields, the create opt, and the chip. Green.
3. `npm run lint:migrations`, then lint + type-check + root build. Check that `type-checks.ts` still compiles.

**Done when:** 6 cases pass, and the migration plus journal plus snapshot are in the commit.

**Risk:** forgetting the journal/snapshot, which makes CI's fresh DB skip the migration. Commit all three together.

---

## Slice 4 — Tool classes + `runViewTool` (not yet registered)

**Files**

- New: `apps/api/src/tools/curated-views/curated-view-tool.util.ts` (`runViewTool`).
- New: `curated-view-{list,get,create,update,delete,share}.tool.ts` in the same folder. Inputs compose the contract fields plus `oneFilterMode`. Share uses `ShareGranteeSchema` and `access: read | read-write | none`. Create's `build(ctx, portalId)` passes `sourcePortalId`.
- New: `apps/api/src/__tests__/tools/curated-views/curated-view-tools.test.ts`, with `CuratedViewService` and `GrantService` mocked via `jest.unstable_mockModule`.

**Steps**

1. **Tests (spec: tools unit, ≈12).**
   - `runViewTool` branches: 403 rethrows, 404 → `TOOL_TARGET_NOT_FOUND`, 409 keeps its code, 500 and non-`ApiError` → the failed code with the generic message.
   - Input schemas reject both filter modes at once, an empty update and an `email` grantee.
   - `columns` → `columnKeys` pass-through.
   - Create forwards `portalId`.
   - Get adds `grants` only when `capabilities.share`.
   - Share `none` with no grant → `revoked:false`; share `none` with a matching grant → revoke called.

   Run; fail.
2. **Implement** the util and the six classes. Green.
3. Lint + type-check.

**Done when:** the unit file is green. Nothing imports the tools yet, so no guard sees them.

---

## Slice 5 — Register and wire `view_management`

All of this lands at once, because the slug, prompt section, build block and name list are mutually forced.

**Files**

- Edit: `packages/core/src/registries/builtin-toolpacks.ts`:
  - slug;
  - `VIEW_MANAGEMENT_PACK` with the six mirrors and an example on the first tool;
  - `CAPABILITIES` (`rbacRead`/`rbacWrite`, JSDoc generalized);
  - `BUILTIN_TOOLPACKS`;
  - `grant_*` mirror descriptions "station, pin, or curated view".
- Edit: `tool-phase-labels.ts` (six labels) and `tier-catalog.ts` (standard + plus).
- Edit: `apps/web/src/utils/tool-pack-icons.util.ts` (`Layers`).
- Edit: `apps/api/src/services/tools.service.ts`. Add the `view_management` block after rbac `:818` and the six names in `BUILTIN_TOOL_NAMES`.
- Edit: `apps/api/src/tools/rbac/grant.tool.ts` descriptions.
- Edit: `apps/api/src/prompts/system.prompt.ts`. Add the `view_management` section with spec items 1–5.
- Edit: `apps/api/src/__tests__/system-principal.guard.test.ts`. Add `CuratedViewCreateTool` to `SESSION_CREATING_TOOLS`.
- Edit (doc sync): `packages/core/src/content/glossary.util.ts`. Add one sentence to "Curated View": views can also be created, edited and shared in a portal session with the Curated Views tool pack, and attaching them stays on the station.

**Steps**

1. **Tests.**
   - Core:
     - `builtin-toolpacks.test.ts`: pack count 10; `view_management` has six tools with valid schemas and an example; capabilities coherent.
     - `tier-catalog.test.ts`: the pack is on every tier.
     - `tool-capabilities.test.ts`: six `free` pins, none write-gated.
     - `glossary.util.test.ts`: pins as needed.
   - API:
     - `tools.service.test.ts`: tools absent when the pack isn't enabled; present on a read-only station (no write capability).
     - `system.prompt.test.ts`: markers present iff the pack is active; capability phrase; the "cannot attach" sentence.

   Run; fail.
2. **Implement** the registry, tiers, labels, icon, build block, names, prompt, descriptions and the guard entry. Green, including the existing guards (cost wrap, NUL, `BUILTIN_TOOL_NAMES` parity, `portalId` threading).
3. Lint + type-check + root build.

**Done when:** every core/api guard passes with the pack present, and a station with the pack enabled builds the six tools.

**Risk:** tier rows are provisioned from the catalog by `portalops tier apply`, so every tier (pro and enterprise included, whose catalog entries pick the pack up through the spread) gains it in an env only after `tier apply` runs there. Record this in the PR.

---

## Slice 6 — Share `member_list` into the pack

**Files**

- Edit: `packages/core/src/registries/builtin-toolpacks.ts`:
  - lift `MEMBER_LIST_TOOL` to a constant used by both packs;
  - broaden its description;
  - give `attachCapabilities` a memo keyed by the source spec, so both packs hold the same object.
- Edit: `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts`. Rewrite case 7: a shared name must be the same object, and a fixture with two distinct specs fails.
- Edit: `apps/api/src/tools/rbac/member.tool.ts` (description) and `tools.service.ts` (build `member_list` when `rbac_management` **or** `view_management` is enabled).
- Edit: `apps/web/src/utils/toolpack-collisions.util.ts`. Key owners by definition, so the built-in shared spec counts as one owner.
- Edit: `apps/api/src/prompts/system.prompt.ts`. View section item 6 (resolve names with `member_list`, ask if ambiguous, team for "the org").

**Steps**

1. **Tests.**
   - Core: rewritten case 7, and `view_management` now has seven tools.
   - API `tools.service.test.ts`: `member_list` built with only `view_management`, with only `rbac_management`, and once with both.
   - Web `toolpack-collisions.util.test.ts`: rbac + view → no collision; a custom pack defining `member_list` → a collision naming both labels.
   - `system.prompt.test.ts`: the member-lookup line.

   ≈8 cases. Run; fail.
2. **Implement.** Green.
3. Lint + type-check + root build.

**Done when:** a station with both packs shows no collision warning and the session has a single `member_list`.

---

## Slice 7 — End-to-end tools integration suite

**Files**

- New: `apps/api/src/__tests__/__integration__/tools/curated-view-tools.integration.test.ts`, modelled on `rbac-tools.integration.test.ts`. Tools are built through `buildAnalyticsTools`, so the input-character, permission, lock and cost gates are all real.

**Steps**

1. **Tests (spec: tools integration, ≈14).**
   - **Admin:** creates a view (listed by the route, with `sourcePortalId` and `createdBy` = admin); updates the label, columns and filter.
   - **Member refusals:**
     - create → `TOOL_PERMISSION_DENIED`;
     - get on an unshared view → `TOOL_TARGET_NOT_FOUND`;
     - update with only a read share → `TOOL_PERMISSION_DENIED`;
     - get with a read share → `filter: null` and no `grants`.
   - **SQL filters:** on `standard` → `CURATED_VIEW_FILTER_SQL_NOT_ENTITLED` while the structured filter works; on `pro` it succeeds.
   - **Delete and share:**
     - delete detaches from a station, with cascade counts;
     - `member_list` → share with a user → `none` revokes;
     - share with the team;
     - a share that widens beyond the caller's own access → `TOOL_PERMISSION_DENIED`.
   - **Errors and availability:** a duplicate key → `CURATED_VIEW_DUPLICATE_KEY`; a cross-org id → `TOOL_TARGET_NOT_FOUND`; tools present on a read-only station.

   Run.
2. **Fix** any gap the suite exposes in the slice that owns it (amend that code here, noting it in the commit body). Green.
3. Lint + type-check.

**Done when:** the suite is green, covering every spec acceptance criterion except the web/chip one (slice 3) and the dialog collision one (slice 6).

---

## Sequence summary

| Slice | Lands | Gate |
|---|---|---|
| 1 | `CuratedViewService`, router on it, `get.columns` | unchanged router suite + 2 |
| 2 | `columnKeys` resolution | service integration (5) |
| 3 | `source_portal_id` migration, model, chip | service (2) + web (4) + `lint:migrations` |
| 4 | six tool classes + `runViewTool` (unregistered) | tools unit (≈12) |
| 5 | pack registered, wired, prompted, tiered; glossary | core + api guards, prompt pins |
| 6 | shared `member_list` | registry invariant, build, collision util (≈8) |
| 7 | end-to-end proof | tools integration (≈14) |

## Cross-slice notes

- **Core rebuilds.** Slices 1, 3, 5 and 6 change `packages/core`. Rebuild core, run the root `npm run build`, and touch an `apps/api/src` file before any live probe (the API dev server keeps a stale core dist).
- **Migration.** Slice 3 only. Expand-only, no backfill. Run `db:migrate` locally, since `npm run dev` seeds but doesn't migrate.
- **No lock descriptor anywhere.** The tools are control-plane (`writes:[]`), so the lock-gate guards never see them. If a guard in slice 5 demands a `TOOL_AUTHORIZATION` entry, that contradicts spec decision 2: stop and kick back to the spec rather than inventing a lock target.
- **Doc sync** (same PR):
  - the three tool surfaces: `.tool.ts`, the `builtin-toolpacks.ts` mirror and `system.prompt.ts` (slices 4–6);
  - the `grant_*` descriptions (slice 5);
  - the glossary "Curated View" sentence (slice 5);
  - `CUSTOM_TOOLPACK_INTEGRATION.md:215` ("must not collide with built-in tool names") stays true and needs no edit.

  No CLAUDE.md convention changes. The shared-tool invariant is recorded in the registry test and the spec.
- **Ops follow-up for the PR body:** `portalops tier apply --env app-dev` (and prod at release) so every tier's rows gain the pack.

## Next step

Implementation starts on this branch with slice 1, tests first, one commit per slice, once this plan is confirmed.

## Smoke-walk amendments

The smoke walk found two gaps, each fixed in its own commit on this branch:

- **Refusals crashed in the SDK.** The AI SDK validates tool input with its own zod copy, and a failed refine left the recursive filter schema on the issue, so the error couldn't be printed. Create and update now give the SDK a refine-free schema and run the refines in `execute` (`CURATED_VIEW_INVALID_PAYLOAD`). Tests: the unit suite runs each refusal through `asSchema().validate`.
- **No way to find an entity.** A session only sees the entities behind its attached views (#599), so the agent couldn't create a view over any other entity. New `curated_view_entity_list` (`CuratedViewService.listEntities`), with the mirror, capability (`rbacRead`), phase label, wiring and prompt guidance. Tests: unit (args), service integration (columns, search, member scoping, other org), tools integration (look up, then create from the returned keys).


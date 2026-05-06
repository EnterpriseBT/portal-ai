# Custom Toolpack Registration — Phase 1 — Plan

**TDD-sequenced implementation of the phase-1 cut: built-in registry + `/toolpacks` page + `station_toolpacks` join + drop legacy `organization_tools`/`station_tools`.**

Spec: `docs/CUSTOM_TOOLPACK_REGISTRATION_PHASE_1.spec.md`. Discovery: `docs/CUSTOM_TOOLPACK_REGISTRATION.discovery.md`.

The change is wide but layered. Eight slices, each behind a green test suite. Slices are intentionally ordered so the red→green loop tightens around one concern at a time, and so the system stays compilable between slices.

Run tests with:

```bash
# from each package — never invoke jest directly (NODE_OPTIONS sets ESM)
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice follows the same loop:

1. Write failing tests for the slice's new behaviour.
2. Implement the smallest change that makes them pass.
3. Run focused tests; confirm green.
4. Run lint + type-check at slice boundary.
5. Move to the next slice.

The slices are sequenced so that:

- **Slices 1–2** establish the registry and contract — pure code, no DB. The whole project still type-checks against the legacy plumbing because nothing is removed yet.
- **Slice 3** adds the `station_toolpacks` table and repository. The schema still has both `stations.tool_packs` jsonb *and* the new join — they coexist briefly. `buildAnalyticsTools` is unchanged.
- **Slice 4** is the cut-over: migrate data into the join, drop `stations.tool_packs`, switch `buildAnalyticsTools` and the station router to read/write the join. After this slice, the `tool_packs` column is gone but `organization_tools` / `station_tools` still exist.
- **Slice 5** drops the legacy `organization_tools` / `station_tools` tables, files, and SDK.
- **Slice 6** mounts the API routes for the registry and adds the route integration tests.
- **Slice 7** adds the web `/toolpacks` page, modal, and SDK.
- **Slice 8** does the response-shape rename across web call sites (`station.toolPacks` → `station.enabledToolpacks`).

Slices 1–2 can be reviewed independently. 3–5 are one logical migration but split for review-ability. 6–8 are visible-end work.

---

## Slice 1 — Registry + contract in `@portalai/core`

The smallest diff. Pure new code; touches nothing existing. Everything downstream depends on it.

**Files**

- New: `packages/core/src/registries/builtin-toolpacks.ts`
- New: `packages/core/src/contracts/toolpack.contract.ts`
- New: `packages/core/src/__tests__/registries/builtin-toolpacks.test.ts`
- New: `packages/core/src/__tests__/contracts/toolpack.contract.test.ts`
- Edit: `packages/core/src/index.ts` (or `contracts/index.ts`, `models/index.ts` — audit) — re-export the new modules.

**Steps**

1. **Write registry tests (cases 1–10).** Tests assert structure (`length === 6`), uniqueness (slug, tool name within and across packs), examples-presence, and `isBuiltinToolpackSlug` semantics. Run; all fail (no module yet).

2. **Write contract tests (cases 11–16).** Discriminated-union parse, request/response shapes. Run; all fail.

3. **Author the registry.** Hand-write `BUILTIN_TOOLPACKS` with all six packs and their tools. Sources for tool descriptions and parameter schemas:

   - `data_query`: `apps/api/src/tools/sql-query.tool.ts`, `visualize.tool.ts`, `visualize-tree.tool.ts`, `resolve-identity.tool.ts`. Copy the `tool({ description })` text and the input shape.
   - `statistics`: `describe-column`, `correlate`, `detect-outliers`, `cluster`, `aggregate`, `hypothesis-test`.
   - `regression`: `regression`, `logistic-regression`, `trend`, `changepoint`, `decompose`, `forecast`.
   - `financial`: `technical-indicator`, `npv`, `irr`, `tvm`, `xnpv`, `xirr`, `depreciation`, `amortize`, `sharpe-ratio`, `max-drawdown`, `rolling-returns`, `var-cvar`, `portfolio-metrics`, `bond-math`.
   - `web_search`: `web-search`.
   - `entity_management`: `entity-record-create/update/delete`, `connector-entity-create/update/delete`, `field-mapping-create/update/delete`.

   For each tool, set `parameterSchema` to a plain JSON-Schema-shaped object derived from the existing Zod schema — pick the smallest faithful representation; do not generate it programmatically yet (D4: hand-author).

   Add at least one example per pack (the first tool's `examples` array must be non-empty). Examples come from the existing analytics test fixtures (`apps/api/src/__tests__/services/analytics.service.test.ts`) — short input + expected-shape output.

4. **Author the contract.** `BuiltinToolpackRecordSchema`, `ToolpackSchema = z.discriminatedUnion("kind", [BuiltinToolpackRecordSchema])`, list/get request and response shapes. Phase 2 will add the `custom` arm to the union; phase 1's discriminator is already in place.

5. **Run focused tests.** `cd packages/core && npm run test:unit -- builtin-toolpacks toolpack.contract`. Both files green.

6. **Lint + type-check.** `npm run lint && npm run type-check` from repo root. Clean.

**Done when:** cases 1–16 pass; nothing else in the repo has changed (the new modules are imported nowhere yet).

**Risk:** none — pure additive code.

---

## Slice 2 — Drop `toolPacks` from `Station` model + contract; introduce `StationToolpack` model

This is the core-side reshape. Without DB or API changes yet, this slice will make `apps/api` and `apps/web` fail to type-check (they still read `station.toolPacks`); we accept the breakage temporarily and unblock it in slices 3–4 (api) and slice 8 (web). To minimise the broken window, slices 1 and 2 land together as one PR; slices 3–5 land before 6–8 so the api+web side never compiles against a half-shape.

**Files**

- New: `packages/core/src/models/station-toolpack.model.ts`
- Edit: `packages/core/src/models/station.model.ts` — drop `toolPacks` and `StationToolPackSchema`.
- Edit: `packages/core/src/contracts/station.contract.ts` — drop the typed `toolPacks` enum from request bodies; add `toolPacks: z.array(z.string().min(1)).min(1).optional()`; add `enabledToolpacks: z.array(z.string()).optional()` to the response shape.
- Edit: `packages/core/src/models/index.ts`, `packages/core/src/contracts/index.ts` — exports.
- Delete: `packages/core/src/models/organization-tool.model.ts`, `packages/core/src/models/station-tool.model.ts`, `packages/core/src/contracts/organization-tool.contract.ts`, `packages/core/src/contracts/station-tool.contract.ts`, plus their tests.

**Steps**

1. **Write a `StationToolpack` model test** — mirror the existing `station.model.test.ts` shape. Assert XOR refinement: a model with both `builtinSlug` and `organizationToolpackId` set fails parse; one with neither fails; one with exactly one passes. Run; all fail.

2. **Write a `Station` model test update** — assert `StationSchema.shape` no longer contains `toolPacks` and that the schema accepts a station object without it. Run; fails.

3. **Author `StationToolpack` model.** Per spec, with the `.refine` for XOR.

4. **Edit `StationSchema`.** Remove `toolPacks: z.array(z.string()).min(1)`. Remove `StationToolPackSchema`.

5. **Edit `station.contract.ts`.** Replace `toolPacks: z.array(StationToolPackSchema).min(1).optional()` with `toolPacks: z.array(z.string().min(1)).min(1).optional()` (lifted off the registry — slug validation moves to the API layer where the registry is imported). Add `enabledToolpacks` to the station response payload schema.

6. **Delete the four legacy `organization-tool*` / `station-tool*` files** and their tests. Update `models/index.ts` and `contracts/index.ts`.

7. **Run focused tests.** `cd packages/core && npm run test:unit`. Existing station model tests need a one-line update (drop the `toolPacks` field from fixture); the new `StationToolpack` test passes; legacy tests are deleted.

8. **Type-check.** `cd packages/core && npm run type-check` is clean.

**Done when:** core builds clean; new and updated tests pass.

**Note:** at the end of slice 2, `apps/api` and `apps/web` are knowingly broken (they read `station.toolPacks`). Slices 3–5 fix the api side; slice 8 fixes the web side. Do not attempt to compile or test those packages between slice 2 and the end of slice 5.

---

## Slice 3 — Add `station_toolpacks` table + repository (alongside legacy)

Add the new join table and its repository. The `stations.tool_packs` column still exists; both representations coexist briefly. Nothing reads from the new table yet — this slice is establishing the schema + repo so slice 4 can switch readers/writers atomically.

**Files**

- New: `apps/api/src/db/schema/station-toolpacks.table.ts`
- New: `apps/api/src/db/repositories/station-toolpacks.repository.ts`
- New: `apps/api/src/__tests__/__integration__/db/repositories/station-toolpacks.repository.integration.test.ts`
- Edit: `apps/api/src/db/schema/index.ts` — re-export.
- Edit: `apps/api/src/db/schema/zod.ts` — `createSelectSchema(stationToolpacks)` + insert schema.
- Edit: `apps/api/src/db/schema/type-checks.ts` — `IsAssignable<StationToolpackSelect, StationToolpack>` block.
- Edit: `apps/api/src/db/repositories/index.ts` — register repo.
- Edit: `apps/api/src/services/db.service.ts` — bind `repository.stationToolpacks`.

**Steps**

1. **Write integration tests (cases 17–26).** Use the existing integration-test scaffolding (`__tests__/__integration__/utils/application.util.ts`). Each test seeds an org + station, then exercises the new repo. Run; all fail (table does not exist).

2. **Author the schema.** Per spec — two nullable columns, XOR CHECK, two partial unique indexes (`builtin_slug` set, `organizationToolpackId` set).

3. **Generate the migration.** From `apps/api`: `npm run db:generate -- --name add_station_toolpacks`. Review generated SQL — should contain only the `CREATE TABLE` and the indexes. Apply with `npm run db:migrate`.

4. **Author the repository.** Extend `Repository<typeof stationToolpacks, …>`. Implement `findByStationId` and `replaceForStation` per spec. `replaceForStation` performs a diff:

   ```ts
   async replaceForStation(stationId, { builtinSlugs }, actor, client = db) {
     const live = await this.findByStationId(stationId, client);
     const liveSlugs = new Set(live.map((r) => r.builtinSlug).filter(Boolean));
     const nextSlugs = new Set(builtinSlugs);

     const toAdd = [...nextSlugs].filter((s) => !liveSlugs.has(s));
     const toRemove = live.filter((r) => r.builtinSlug && !nextSlugs.has(r.builtinSlug));

     if (toAdd.length === 0 && toRemove.length === 0) return;

     await Repository.transaction(async (tx) => {
       for (const id of toRemove.map((r) => r.id)) {
         await this.softDelete(id, actor.userId, tx);
       }
       for (const slug of toAdd) {
         const factory = new StationToolpackModelFactory();
         const m = factory.create(actor.userId);
         m.update({ stationId, builtinSlug: slug, organizationToolpackId: null });
         await this.create(m.parse(), tx);
       }
     }, client);
   }
   ```

5. **Wire into `DbService`.** Add `stationToolpacks: stationToolpacksRepo` to the `repository` object.

6. **Run integration tests.** `cd apps/api && npm run test:integration -- station-toolpacks.repository`. All ten cases green.

7. **Lint + type-check.** Clean.

**Done when:** cases 17–26 pass; the new table exists in the dev DB; nothing reads from it yet.

**Risk:** generated migration omits the partial-index `WHERE deleted IS NULL` clause. Drizzle does generate `.where(...)` correctly for `uniqueIndex`, but inspect the SQL before applying.

---

## Slice 4 — Migrate data, drop `stations.tool_packs`, switch readers/writers

The destructive cut. After this slice, `station_toolpacks` is the source of truth and `stations.tool_packs` no longer exists. `buildAnalyticsTools` and the station router read/write the join.

**Files**

- New (Drizzle migration): `apps/api/src/db/migrations/<timestamp>_drop_stations_tool_packs.sql`
- New: `apps/api/src/__tests__/__integration__/db/migrations/phase_1_toolpacks.test.ts`
- Edit: `apps/api/src/db/schema/stations.table.ts` — remove the `toolPacks` column.
- Edit: `apps/api/src/db/schema/type-checks.ts` — collapse the `Station` block (remove the `Omit<…, "toolPacks">` workaround now that the model and the row are aligned).
- Edit: `apps/api/src/services/tools.service.ts` — replace `station.toolPacks` read with `repo.stationToolpacks.findByStationId`.
- Edit: `apps/api/src/routes/station.router.ts` — replace `toolPacks` read/write with calls into `repo.stationToolpacks.replaceForStation`; add `enabledToolpacks` to the include payload on GETs.
- Edit: `apps/api/src/__tests__/services/tools.service.test.ts` — service-layer cases 32–35 (audit if file exists).
- Edit: `apps/api/src/__tests__/__integration__/routes/station.router.integration.test.ts` — cases 43–48.

**Steps**

1. **Write migration test (case 27).** Seed a station with `tool_packs: ["data_query", "statistics"]` *before* applying the migration; apply; assert two `station_toolpacks` rows. Use the integration-test setup-then-migrate pattern (audit existing migration tests; if none, write one — the migration runner is deterministic, see `apps/api/src/db/client.ts` and `drizzle.config.ts`).

2. **Write migration tests (cases 28–31).** Empty array → no rows; column does not exist post-migration; legacy tables do not exist post-migration.

3. **Write `tools.service.ts` tests (cases 32–35).** Mock `repo.stationToolpacks.findByStationId`; assert `buildAnalyticsTools` reads from there. Run; all fail (service still reads `station.toolPacks`).

4. **Write station router integration tests (cases 43–48).** Run; some fail (existing tests pass; new include-payload test fails).

5. **Hand-write the migration SQL.** Generate first via `npm run db:generate -- --name drop_stations_tool_packs_use_join`; the generated file will only have `ALTER TABLE stations DROP COLUMN tool_packs`. Hand-edit to insert the data move *before* the column drop:

   ```sql
   -- Move data from stations.tool_packs into station_toolpacks rows
   INSERT INTO station_toolpacks
     (id, created, created_by, updated, updated_by, deleted, deleted_by,
      station_id, builtin_slug, organization_toolpack_id)
   SELECT
     -- 21-char nanoid; matches base.columns id default
     substring(md5(random()::text || s.id || pack.value) from 1 for 21),
     EXTRACT(EPOCH FROM NOW()) * 1000,
     s.created_by,
     NULL, NULL, NULL, NULL,
     s.id,
     pack.value::text,
     NULL
   FROM stations s
   CROSS JOIN LATERAL jsonb_array_elements_text(s.tool_packs) AS pack(value)
   WHERE s.deleted IS NULL;

   ALTER TABLE stations DROP COLUMN tool_packs;
   ```

   (If the project's id-generation convention differs — `apps/api/src/utils/id.util.ts` is the source of truth — substitute the matching expression. Verify by reading the existing migrations.)

6. **Apply the migration.** `npm run db:migrate`. Run integration tests for cases 27–31; green.

7. **Implement the `tools.service.ts` change.** Replace `station.toolPacks` read with `findByStationId`. Drop `buildCustomWebhookTools` (slice 5 will do the file-level removal; the call here goes now).

   ```ts
   const enabled = await DbService.repository.stationToolpacks.findByStationId(stationId);
   const builtinRows = enabled.filter((r) => r.builtinSlug !== null);
   const customRows  = enabled.filter((r) => r.organizationToolpackId !== null);

   if (customRows.length > 0) {
     logger.warn({ stationId, count: customRows.length }, "Custom toolpack rows present but not yet supported");
   }
   if (builtinRows.length === 0) {
     throw new Error("Station must have at least one tool pack enabled");
   }

   const enabledPacks = new Set<string>(builtinRows.map((r) => r.builtinSlug!));
   ```

   Run service tests; cases 32–35 green.

8. **Update the station router.** Read incoming `toolPacks` from the create/update body, validate each slug is a known built-in (`isBuiltinToolpackSlug` from the registry), call `replaceForStation`. On GET, fetch `enabledToolpacks` from the repo and include in the response payload.

   - Validation failure (`unknown slug`) returns `400 STATION_INVALID_TOOLPACK`.
   - Add the new error code to `apps/api/src/constants/api-codes.constants.ts`.

9. **Run station router integration tests.** Cases 43–48 green. Existing tests that pass `toolPacks: [...]` continue to work because the body shape is unchanged.

10. **Lint + type-check.** Clean. The `Omit<Station, "toolPacks">` workaround in `type-checks.ts` collapses to a direct `IsAssignable<Station, StationSelect>` — confirm no compile error.

**Done when:** cases 27–35 and 43–48 pass; the dev database has no `stations.tool_packs` column; full `apps/api` test suite passes.

**Risk:** the generated id-generation SQL doesn't match the project's nanoid convention, producing rows with shapes that the repo can't read back. Mitigation: read the existing seed scripts (`apps/api/src/db/seed.ts`) for the id-generation function in use, and either invoke it from a JS-driven migration step (`tsx`-loaded migration file) or replicate the exact SQL expression. If the project uses a Postgres-side `gen_random_uuid()` cast to text, use that.

---

## Slice 5 — Drop `organization_tools` and `station_tools`

The legacy tables, files, and SDK go. After this slice, the only "tool"-related plumbing left is the new `station_toolpacks` join, the registry, and the (still-present but unused) `WebhookTool` class.

**Files**

- New (Drizzle migration): `apps/api/src/db/migrations/<timestamp>_drop_organization_tools.sql`
- Delete (api):
  - `src/db/schema/organization-tools.table.ts`
  - `src/db/schema/station-tools.table.ts`
  - `src/db/repositories/organization-tools.repository.ts`
  - `src/db/repositories/station-tools.repository.ts`
  - `src/routes/organization-tools.router.ts`
  - `src/routes/station-tools.router.ts`
  - All four corresponding integration tests under `__tests__/__integration__/`.
- Delete (web): `src/api/organization-tools.api.ts`, `src/__tests__/api/organization-tools.api.test.ts`.
- Edit (api): `src/db/schema/index.ts`, `src/db/schema/zod.ts`, `src/db/schema/type-checks.ts`, `src/db/repositories/index.ts`, `src/services/db.service.ts`, `src/services/tools.service.ts` (drop `buildCustomWebhookTools`), `src/app.ts` (or wherever the routers mount), `src/constants/api-codes.constants.ts`.
- Edit (web): `src/api/sdk.ts`, `src/api/keys.ts`.

**Steps**

1. **Generate the migration.** `npm run db:generate -- --name drop_organization_tools_and_station_tools`. Inspect SQL — should contain `DROP TABLE station_tools;` and `DROP TABLE organization_tools;` in the right order (FK dependency).

2. **Apply the migration.** `npm run db:migrate`. Confirm via `\d` in `db:studio` that the tables are gone.

3. **Delete files.** All listed above. Do not introduce compat shims.

4. **Edit schema barrel + zod.ts + type-checks.** Drop the `organizationTools` and `stationTools` re-exports, the zod schemas, and the type-check blocks.

5. **Edit repositories + db.service.** Drop `organizationToolsRepo` and `stationToolsRepo` registrations.

6. **Edit `tools.service.ts`.** Remove the import of `WebhookTool` and the `buildCustomWebhookTools` function (already disconnected from the call site in slice 4 — this is the file-level cleanup). Leave `WebhookTool` itself (`apps/api/src/tools/webhook.tool.ts`) — phase 2 wires it back in. Add a top-of-file comment to `webhook.tool.ts` noting "unused after phase 1; reintroduced in phase 2 for custom toolpacks".

7. **Edit route mounts.** In `app.ts` or the router barrel, drop `app.use("/api/organization-tools", organizationToolsRouter)` and the station-tools mount.

8. **Edit api codes.** Drop `ORG_TOOL_*` and `STATION_TOOL_*` enum entries.

9. **Edit web SDK.** Drop `organizationTools` from `sdk.ts` and `keys.ts`. (No `station-tools` SDK exists today — confirm.)

10. **Run unit + integration tests.** `cd apps/api && npm run test:unit && npm run test:integration` and `cd apps/web && npm run test:unit`. Anything that imports from a deleted file fails fast — that's expected; any remaining failure indicates a missed call site.

11. **Type-check.** Clean. The `git ls-files | grep -E '(organization-tool|station-tools.table)'` audit returns empty.

**Done when:** legacy tables and files are gone; full test suites green.

**Risk:** an integration test fixture imports `organizationTools` schema. Search for `organization_tools` and `station_tools` in test fixtures and seed data; remove.

---

## Slice 6 — Mount `/api/toolpacks` (built-ins only)

The API surface for the registry. Read-only this phase.

**Files**

- New: `apps/api/src/routes/toolpacks.router.ts`
- New: `apps/api/src/__tests__/__integration__/routes/toolpacks.router.integration.test.ts`
- Edit: `apps/api/src/app.ts` — mount.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `TOOLPACK_NOT_FOUND` if not already added.

**Steps**

1. **Write integration tests (cases 36–42).** Mock auth + org middleware (same pattern as the existing organization-tools router test). Run; all fail.

2. **Author the router.** Two endpoints:

   ```ts
   toolpacksRouter.get("/", getApplicationMetadata, async (req, res, next) => {
     try {
       const { search, kind } = ToolpackListRequestQuerySchema.parse(req.query);
       const all = BUILTIN_TOOLPACKS.map(toApiRecord);  // adds id = "builtin:" + slug, kind = "builtin"
       let filtered = kind === "custom" ? [] : all;
       if (search) {
         const q = search.toLowerCase();
         filtered = filtered.filter(matchesSearch(q));
       }
       return HttpService.success<ToolpackListResponsePayload>(res, {
         toolpacks: filtered,
         total: filtered.length,
       });
     } catch (error) {
       return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.TOOLPACK_NOT_FOUND, "Failed to list toolpacks"));
     }
   });

   toolpacksRouter.get("/:id", getApplicationMetadata, async (req, res, next) => {
     try {
       const { id } = req.params;
       if (!id.startsWith("builtin:")) {
         return next(new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found"));
       }
       const slug = id.slice("builtin:".length);
       if (!isBuiltinToolpackSlug(slug)) {
         return next(new ApiError(404, ApiCode.TOOLPACK_NOT_FOUND, "Toolpack not found"));
       }
       return HttpService.success<ToolpackGetResponsePayload>(res, {
         toolpack: toApiRecord(BUILTIN_TOOLPACK_BY_SLUG[slug]),
       });
     } catch (error) {
       return next(error instanceof ApiError ? error : new ApiError(500, ApiCode.TOOLPACK_NOT_FOUND, "Failed to get toolpack"));
     }
   });
   ```

3. **Mount in `app.ts`.** `app.use("/api/toolpacks", toolpacksRouter)`.

4. **Run integration tests.** Cases 36–42 green.

5. **Update Swagger.** The router uses the project's `@openapi` JSDoc comments (see `organization-tools.router.ts` for the pattern). Run `npm run swagger:generate` from `apps/api` and confirm the new endpoints appear in `/api-docs`.

**Done when:** cases 36–42 pass; manual `curl http://localhost:3001/api/toolpacks` (with auth header) returns six built-in records.

**Risk:** none.

---

## Slice 7 — Web `/toolpacks` page + metadata modal

The user-facing UI. Read-only this phase.

**Files**

- New: `apps/web/src/api/toolpacks.api.ts`
- New: `apps/web/src/routes/toolpacks.index.tsx`
- New: `apps/web/src/views/Toolpacks.view.tsx` (container + UI)
- New: `apps/web/src/components/ToolpackMetadataModal.component.tsx` (pure UI)
- New: `apps/web/src/__tests__/Toolpacks.view.test.tsx`
- New: `apps/web/src/__tests__/ToolpackMetadataModal.test.tsx`
- Edit: `apps/web/src/api/sdk.ts`, `apps/web/src/api/keys.ts`
- Edit: `apps/web/src/utils/routes.util.ts` — `Toolpacks = "/toolpacks"`
- Edit: `apps/web/src/components/SidebarNav.component.tsx` — entry between Stations and Connectors.

**Steps**

1. **Write modal tests (cases 54–57).** `ToolpackMetadataModal` is a pure UI component (per the project's component file policy). Tests render with a fixture `Toolpack` prop; assert content. Run; all fail.

2. **Write view tests (cases 49–53).** Mock `sdk.toolpacks.list` via `jest.unstable_mockModule` (the existing project pattern for ESM). Assert filter behaviour, sort behaviour, click → modal open. Run; all fail.

3. **Author the modal.** Pure UI, no hooks. Follows the project's Form & Dialog Pattern for accessibility (focus management, escape-to-close, etc.) — but it has no form, so no `useDialogAutoFocus` or `<FormAlert>`. Just `Modal` + `DialogContent` rendering the toolpack.

4. **Author the SDK.** Per spec — `list` and `get` via `useAuthQuery`.

5. **Author the view.** Container fetches via `sdk.toolpacks.list()`, manages `selected` state, renders `ToolpacksUI` with `toolpacks`, `onSelect`. UI renders the existing `DataTable` component with the columns from the spec. Click a row → `onSelect(id)` → container looks up the pack and opens the modal.

6. **Add the route + sidebar entry + route enum.** Standard plumbing.

7. **Run web tests.** `cd apps/web && npm run test:unit -- Toolpacks ToolpackMetadataModal`. Green.

8. **Manual verification.** `npm run dev` from repo root; visit `http://localhost:3000/toolpacks`; confirm the table renders six rows; click `data_query`; confirm the modal opens with the right content.

**Done when:** cases 49–57 pass; manual smoke passes.

**Risk:** the `DataTable` component's filter/sort hooks (audit `apps/web/src/components/DataTable*` for the public API) may not match exactly what the spec assumes. If filter/sort can't be expressed via props, fall back to client-side filtering inside the container and re-pass `toolpacks` to the UI. Cases 50–51 are the canary.

---

## Slice 8 — Web call-site rename + sidebar entry verification

The mechanical rename across the rest of `apps/web` so `station.toolPacks` (no longer in the contract) becomes `station.enabledToolpacks` (the new include payload). Form-state keys stay `toolPacks` (the request body shape).

**Files**

- Edit: `apps/web/src/views/StationDetail.view.tsx` — line 211 (chip render) and 217 (hidden check).
- Edit: `apps/web/src/views/Portal.view.tsx` — line 148 (assignment) and 199 (hidden check).
- Edit: `apps/web/src/components/StationList.component.tsx` — line 124 and 130.
- Edit: `apps/web/src/components/DefaultStationCard.component.tsx` — line 118 and 124.
- Edit: `apps/web/src/components/EditStationDialog.component.tsx` — line 76 (form-state seed: `[...station.enabledToolpacks]`).
- Edit (fixtures): `apps/web/src/__tests__/EditStationDialog.test.tsx`, `Portal.view.test.tsx`, `CreateStationDialog.test.tsx`, `CreatePortalDialog.test.tsx`, `StationList.test.tsx`, `DeleteStationDialog.test.tsx`, `DefaultStationCard.test.tsx`.
- Edit: `apps/web/src/utils/tool-packs.util.ts` — collapse to a façade reading from `BUILTIN_TOOLPACK_BY_SLUG`.

**Steps**

1. **Type-check from the top.** `npm run type-check` from repo root. The compiler enumerates every `station.toolPacks` access since the contract dropped the field. List output is the work plan for this slice.

2. **Mechanical edit.** For each call site:

   - **Read paths** (`station.toolPacks.map(...)`, `station.toolPacks.length`): rename to `station.enabledToolpacks` (or `station.enabledToolpacks ?? []` if the include isn't guaranteed; default-include in the API means it usually is).
   - **Form-state seed in EditStationDialog** (line 76): change `toolPacks: [...station.toolPacks]` to `toolPacks: [...station.enabledToolpacks]`.
   - **Test fixtures**: replace `toolPacks: [...]` with `enabledToolpacks: [...]`. The mock station object now matches the new response shape.

3. **Update `tool-packs.util.ts`.** Replace the hand-maintained `TOOL_PACK_LABELS` map with a registry-backed lookup:

   ```ts
   import { BUILTIN_TOOLPACK_BY_SLUG, isBuiltinToolpackSlug } from "@portalai/core/registries/builtin-toolpacks";

   export class ToolPackUtil {
     static getLabel(pack: string): string {
       if (isBuiltinToolpackSlug(pack)) {
         return BUILTIN_TOOLPACK_BY_SLUG[pack].name;
       }
       return pack;
     }
   }
   ```

   Existing `__tests__/ToolPackUtil.test.ts` continues to pass — the labels are identical.

4. **Type-check + lint.** Clean.

5. **Run all `apps/web` tests.** `cd apps/web && npm run test:unit`. Existing tests pass with the renamed fixtures.

6. **Manual smoke (full path).** Restart dev, log in, create a station with `["data_query", "statistics"]`, save. Open the station detail; the chips render. Open a portal session; the chips render. Edit the station; the picker reflects the saved selection. Save a different selection; the chips update.

7. **Delete `apps/web/src/api/organization-tools.api.ts`** and its test (already removed in slice 5 if not earlier; double-check). The rename audit (`grep -r "station\.toolPacks" apps/web/src` returns empty) is the final check.

**Done when:** all call sites are renamed; web tests pass; manual smoke passes; the rename audit is empty.

**Risk:** dynamic property access in JSX (`station[someKey]`) hides a `toolPacks` reference from grep. Type-check catches it. If a runtime-only string indexes shows up — e.g. in a serialization step — the smoke test catches it.

---

## Sequence summary

| Slice | What lands | Tests added | Test commands |
|---|---|---|---|
| 1 | Registry + contract in `@portalai/core` | 16 | `cd packages/core && npm run test:unit` |
| 2 | Drop `Station.toolPacks`; add `StationToolpack` model; delete legacy core files | 1 model test + edits | `cd packages/core && npm run test:unit` |
| 3 | `station_toolpacks` table + repo (alongside legacy) | 10 | `cd apps/api && npm run test:integration -- station-toolpacks` |
| 4 | Migrate data, drop `stations.tool_packs`, switch readers/writers | 5+6 (services + station router) + 5 migration | `cd apps/api && npm run test:integration` |
| 5 | Drop `organization_tools` / `station_tools` files + tables | — (deletion only) | full `apps/api` suite |
| 6 | Mount `/api/toolpacks` (read-only) | 7 | `cd apps/api && npm run test:integration -- toolpacks.router` |
| 7 | Web `/toolpacks` page + modal | 9 | `cd apps/web && npm run test:unit -- Toolpacks` |
| 8 | Web call-site rename | 0 new (fixture renames) | `cd apps/web && npm run test:unit` |

Total new test cases: **57**, plus the migration-level smoke probe.

**Recommended PR boundaries**

- **PR 1**: slices 1 + 2 (`@portalai/core` reshape). Fast-track review; pure code, no DB.
- **PR 2**: slices 3 + 4 + 5 (the schema cut). One review pass on the migration. Lands the substance.
- **PR 3**: slices 6 + 7 + 8 (the visible end). Tested end-to-end behind a working backend.

Three PRs is the sweet spot: small enough to review piecemeal, large enough that no PR is in a knowingly-broken-compile state for the consuming package.

---

## Cross-slice notes

- **Migration-test discipline.** Cases 27–31 run *against a fresh test database* using the integration-test setup pattern. The migration is applied as part of the `beforeAll` hook (existing pattern in the integration suite); the test then either probes the schema (`information_schema` queries) or reads/writes via the repos.

- **No new dependencies.** Phase 1 is pure schema + code shuffle. No npm package added on either side of the monorepo. Confirm via `git diff package*.json` — should show no changes besides `apps/web` adding nothing and `packages/core` adding nothing.

- **Logging.** `buildAnalyticsTools` emits the existing `"Analytics tools built"` log. Phase 1 adds a `"Custom toolpack rows present but unsupported"` warn-level log when an `organizationToolpackId` row is encountered. This is dead-code-defensive (no such row can exist in phase 1) but documents the phase-2 wire-up site.

- **Soft-delete consistency.** The `replaceForStation` repo soft-deletes — it never hard-deletes. This matches the project's audit-trail convention. The `WHERE deleted IS NULL` filter on partial unique indexes guarantees re-adding a soft-deleted slug succeeds.

- **No frontend route guard changes.** `_authorized` layout already covers `/toolpacks` because route-tree auto-generation includes it under the same prefix as siblings.

- **Storybook.** Phase 1 does not add stories. Phase 2 does (RegisterToolpackDialog and friends). `ToolpackMetadataModal` would be a natural Storybook subject; if storybook coverage is the project's expectation for new pure-UI components, add a single `ToolpackMetadataModal.stories.tsx` with two stories (a built-in pack with examples; the same pack with `examples` cleared).

- **CLAUDE.md compliance.** All naming follows the file-suffix conventions (`*.component.tsx`, `*.view.tsx`, `*.util.ts`, `*.router.ts`, `*.repository.ts`, `*.table.ts`). The single new view (`Toolpacks.view.tsx`) splits container + UI per the Component File Policy. The modal is single-component (pure UI). The SDK helper sits under `apps/web/src/api/`. Mutation cache invalidation policy doesn't apply here (no mutations in phase 1).

# Demo seeder — Plan

**Issue:** [EnterpriseBT/portal-ai#509](https://github.com/EnterpriseBT/portal-ai/issues/509) · **Spec:** `docs/DEMO_SEEDER.spec.md` · **Discovery:** `docs/DEMO_SEEDER.discovery.md`

Eight TDD slices, each a testable commit on `feat/demo-seeder`. Tests run via npm scripts only (`cd apps/api && npm run test:unit`/`test:integration`; `cd packages/admin-cli && npm run test:unit`) — never raw jest. Slices 1–6 are `apps/api`; 7 is the `admin-cli` CLI; 8 is docs. Slice 1 depends on #508 being merged into the epic (done — the branch already carries it).

---

## Slice 1 — Relocate the #508 dataset into `apps/api`

**Goal.** Move the dataset to where the seeder (an `apps/api` script) can import it; `admin-cli` keeps none of it.

**Moves.**
- `packages/admin-cli/src/fixtures/demo-data.ts` → `apps/api/src/demo/demo-data.ts` (imports unchanged — dependency-free).
- `packages/admin-cli/fixtures/demo/*.csv|*.xlsx` → `apps/api/fixtures/demo/*`.
- `packages/admin-cli/fixtures/demo/generate.ts` → `apps/api/src/scripts/generate-demo-fixtures.ts`; move the `fixtures:demo` npm script to `apps/api/package.json` (update the relative import + OUT_DIR + the `apps/site/public/demo` path from the new location).
- `packages/admin-cli/src/__tests__/demo-dataset.test.ts` → `apps/api/src/__tests__/demo-dataset.test.ts` (update the `../fixtures/demo-data.js` + `FIXTURES` paths).
- Drop `exceljs`/`tsx` from `admin-cli` devDeps if unused after the move; confirm `apps/api` has `exceljs` + a TS-script runner.

**Test-first.** Run the relocated `demo-dataset.test.ts` at its new path → green (same assertions: counts, join closure, determinism, transactions FK + lazy stream, committed-file sync). Then `npm run --workspace @portalai/api fixtures:demo` regenerates CSV/JSON byte-identically and `apps/site/public/demo/inventory.json` still lands.

**Done when.** `apps/api` test:unit green; `admin-cli` has no `demo-data`/fixtures; `git grep demo-data packages/admin-cli` empty; site asset still emitted.

---

## Slice 2 — `DemoSeedService.seed` core: one entity end-to-end

**Goal.** Prove the entity→mappings→reconcile→import pipeline for a single entity (`customers`) under the Sandbox instance.

**Build.** `apps/api/src/services/demo-seed.service.ts` — `seed({ orgId })` that, for `customers`:
- resolves Sandbox instance (`connectorDefinitions.findBySlug("sandbox")` → `connectorInstances.findByOrgDefinitionAndName(orgId, defId, "Sandbox")`);
- `connectorEntities.upsertByKey({ connectorInstanceId, organizationId, key:"customers", label })`;
- per dictionary column: `columnDefinitions.findByKey(orgId, key)` → `fieldMappings.upsertByEntityAndNormalizedKey({...})`;
- `wideTableReconcilerService.reconcileEntity(entityId, tx)`;
- a CSV reader (`apps/api/src/demo/csv-reader.ts`, `AsyncIterable<Record<string,string>>`) → `importRows(reader, { connectorEntityId, organizationId, userId: SYSTEM })`.
- Return a partial `DemoSeedResult` (customers entry only).

**Test-first (integration, test DB / e2e fixture org).**
1. After `seed`, the `customers` entity exists with `COUNTS.customers` records; `--json` shows `created = COUNTS.customers`.
2. A sampled record's `c_*` wide columns are populated (projection ran).
3. Re-run `seed` → customers `unchanged` (positional source_id + stable file order).
4. Missing column definition for a mapped key → the service throws a clear error (does not create column defs).

**Done when.** `apps/api` test:integration green for the four cases.

---

## Slice 3 — All base entities from CSV/XLSX

**Goal.** Generalize slice 2 to every committed entity, including the multi-sheet XLSX and reference columns.

**Build.** A dictionary-driven entity table (`apps/api/src/demo/dataset-manifest.ts`) mapping each entity → `{ instance, file/reader, mappings[] }`; an XLSX reader (reuses `exceljs` streaming) that yields rows per sheet for `orders.xlsx`; reference mappings (`orders.customer_id` → `refEntityKey:"customers"`, `refNormalizedKey`). `seed` loops the manifest. `inventory` (REST-shaped) is imported from its committed JSON here (the REST *instance* is optional — see Risks; base slice imports the records so they're visible).

**Test-first (integration).**
5. All base entities present with dictionary counts; `--json` per-entity created counts correct.
6. Cross-entity integrity: a sampled `orders` row's `customer_id` resolves to a real customer (ref mapping set); `orders` count spans all XLSX sheets.
7. Full re-seed → every base entity `unchanged`.

**Done when.** test:integration green; base dataset fully converges idempotently.

---

## Slice 4 — Streamed `transactions` at scale + `--rows`

**Goal.** The large-volume table via the streaming synth, bounded and deterministic.

**Build.** `seed({ orgId, rows })` provisions the `transactions` entity under Sandbox and imports `synthesizeTransactions(rows ?? DEFAULT, seed, refs)` (refs from the just-seeded customers/products/sites ids) straight into `importRows`. `DEFAULT` ≈ 1M (app-dev/prod); the CLI passes a smaller `--rows` locally. Never materialize the generator into an array.

**Test-first (integration).**
8. `seed({ rows: 5000 })` writes 5000 `transactions`; FKs resolve; `--json` reports the count + `durationMs`.
9. Re-run with the same `rows` → `unchanged` (deterministic order).
10. The import path holds O(batch) memory (assert the generator is consumed lazily — e.g. a spy/counter proving rows aren't pre-collected). *(1M timing is verified on app-dev in smoke, not in the unit DB.)*

**Done when.** test:integration green; `--rows` override works; no full-array materialization.

---

## Slice 5 — Toolpacks + station assignment

**Goal.** All eight built-ins + the #510 custom toolpack on the demo station.

**Build.** In `seed`: register the custom pack in-process (`generateSigningSecret()` → `ToolpackRegistrationService.fetchSchema(url)` → `validateNoBuiltinCollision` → `organizationToolpacks.create(...)`), URL from config. **Config decision:** add `ssm("DEMO_TOOLPACK_URL","demo-toolpack-url")` to the portalops catalog; the CLI resolves it and passes `--toolpack-url` to the script (update `catalog.test.ts` ssm pin). If unset/unreachable, skip the custom pack (built-ins still enable) and mark `toolpacks.custom = null`. Find/create the station (`stations.findByOrganizationId`) → `stationToolpacks.replaceForStation(stationId, { builtinSlugs:[…8], organizationToolpackIds:[customId] }, { userId }, tx)`.

**Test-first (integration, custom-toolpack fetch mocked).**
11. After `seed`, the station lists all eight built-in slugs + the custom `org:<id>` pack.
12. With no `--toolpack-url`, `seed` enables the eight built-ins and reports `custom:null` (no throw).

**Done when.** test:integration green; catalog pin updated + `devops-cli` tests green.

---

## Slice 6 — `reset()`

**Goal.** Clean-slate to the checked-in baseline; prod-blocked at the CLI layer (slice 7 enforces the guard).

**Build.** `DemoSeedService.reset({ orgId })` — delete the org's portals (messages/results) + soft-delete the seeded entities' records, then call `seed()` to reconverge; never touch OAuth (Google Sheets) instances/tokens.

**Test-first (integration).**
13. `reset` on a seeded org → zero portals + checked-in record counts; a following `seed` is all-`unchanged`.
14. A mock Google Sheets OAuth instance + token survive `reset` and `seed`; `seed` reports `googleSheets.present:true` without mutating it.

**Done when.** test:integration green.

---

## Slice 7 — `demo.ts` CLI + guards + `--json`

**Goal.** The operator surface that spawns the scripts with the correct guard matrix.

**Build.** `packages/admin-cli/src/commands/demo.ts` (`demoSeed`/`demoReset` per the spec Surface) + the `demo` group in `bin.ts`. `demoSeed` → `beginMutation(def, flags, false)` + `runApiScript(def, "db:demo:seed", ["--org", …, "--rows"?, "--toolpack-url"?])`; `demoReset` → `beginMutation(def, flags, true)`. Resolve `--toolpack-url` from the catalog when set. Parse `lastJsonLine` → typed result.

**Test-first (admin-cli unit, spawn + guard mocked).**
15. `demoSeed` calls `beginMutation(…, false)` and spawns `db:demo:seed` with `--org` (+`--rows` when given); parses the JSON summary.
16. `demoReset` → `beginMutation(…, true)`: prod blocked (exit 6) before any spawn; app-dev needs `--yes`.
17. `demo seed --env prod` without `--confirm-prod` → exit 5; with `--yes --confirm-prod` → spawns.
18. `--json` → summary on stdout, banner on stderr, exit 0.

**Done when.** `admin-cli` test:unit green; the guard matrix matches the spec.

---

## Slice 8 — Docs

**Goal.** Keep the durable operator docs in sync (CLAUDE.md → "Keeping Documentation in Sync").

**Build.** `packages/admin-cli/COMMANDS.md` gains `demo seed`/`demo reset` (flags, exit codes, `--json` shape, prod semantics). `docs/CLI_OPERATIONS_CHARTER.md` gains the two op rows + recomputed coverage. Add the `DEMO_TOOLPACK_URL` catalog row to `packages/devops-cli/COMMANDS.md` if that's where catalog keys are documented.

**Done when.** docs updated; `npm run lint:doc-pointers` green; no stale citation.

---

## Sequencing & integration notes

- Slices land in order; 2–6 each keep `apps/api` green. The `--json` `DemoSeedResult`/`DemoResetResult` shape freezes in slice 2 (extended, not reshaped, after) — it's the contract #511's runbook + epic smoke read.
- **Epic keep-pace:** merge `main` into `epic/demo-org` before this child merges (the epic is currently behind `main`).
- **Smoke** (epic close-out, human): `demo seed --env app-dev` on the demo org → all entities `active` with counts, station toolpacks present, records visible in the connector view; second `seed` all-`unchanged`; `demo reset` → baseline; `demo seed --env prod --yes --confirm-prod` converges; the ~1M `transactions` seed completes in the target minutes on app-dev. This is where the large-volume timing and the live sync/upload job-in-UI story are verified.

# Demo seeder (`portalai demo seed` / `demo reset`) — Spec

**Issue:** [EnterpriseBT/portal-ai#509](https://github.com/EnterpriseBT/portal-ai/issues/509) · **Epic:** #507 · **Discovery:** `docs/DEMO_SEEDER.discovery.md`

Pins the contract for the re-runnable demo-org populator: two thin `admin-cli` commands (`demo seed` / `demo reset`) that spawn new `apps/api` scripts (`db:demo:seed` / `db:demo:reset`), which drive a new in-process `DemoSeedService` that provisions connector entities + field mappings, builds wide tables, and dual-writes records via `importRows` — reading committed CSV/XLSX for base entities and streaming `synthesizeTransactions` for the ~1M-row `transactions` table. **No new DB tables, no schema migration** — it populates existing `entity_records`/`connector_entities`/`field_mappings` through the app's real import path.

## Key decisions (from discovery, ratified)

- **D1 — Transport: spawned `apps/api` script**, not an HTTP client (none exists) and not the raw `AdminStore` (bypasses app logic). `demo.ts` → `runApiScript(def, "db:demo:seed", …)`, mirroring `provision.ts`'s `seedOrg`.
- **D2 — In-process import; no BullMQ jobs.** Records are written via `importRows`; the demo's job-in-UI story comes from a live sync/upload on the day. Acceptance amended to "records visible in the connector view."
- **D3 — Relocate the #508 dataset into `apps/api`** (synth + fixtures + generator + integrity test); `admin-cli` keeps only the `demo` command.
- **D4 — Guard: `seed` non-destructive** (prod via `--yes --confirm-prod`), **`reset` destructive** (prod-blocked, exit 6).
- **D5 — Idempotent convergence.** `importRows` keys upserts on `(connectorEntityId, source_id)` where **`source_id` is the positional row index** (`record-import.util.ts:167` — not a business key). Idempotency therefore rests on **stable yield order**: the committed fixtures and the deterministic synth emit rows in the same order every run, so a re-seed reproduces the same `source_id`s and per-row checksums → all-`unchanged`. Connector instances/entities converge by name/key (idempotent upserts). `--json` reports per-entity `{created,updated,unchanged,invalid}`.

## Scope

### In scope
1. **Dataset relocation** — move `demo-data.ts`, `fixtures/demo/*`, the generator, and the integrity test from `packages/admin-cli` into `apps/api`.
2. **`DemoSeedService`** (`apps/api/src/services/demo-seed.service.ts`) — `seed()` + `reset()` orchestration over the real import primitives.
3. **`db:demo:seed` / `db:demo:reset` scripts** (`apps/api/src/db/`) + `apps/api/package.json` script entries.
4. **`demo.ts` CLI** (`packages/admin-cli/src/commands/demo.ts`) + `bin.ts` `demo` group.
5. **`--json` summary contract** — the per-entity/per-instance result shape #511's runbook + epic smoke read.
6. **Docs** — `packages/admin-cli/COMMANDS.md`, `docs/CLI_OPERATIONS_CHARTER.md` op rows + coverage.

### Out of scope
- Dataset content / synth logic (#508) — relocated, not authored.
- Toolpack hosting (#510) — its URL is read from config.
- Org creation, Demo tier, OAuth connection (#511) — the seeder targets an existing org; never touches OAuth instances.
- Driving real BullMQ upload/sync jobs (discovery 2b) — dropped.
- Any new DB table / migration.

## Surface

### CLI — `packages/admin-cli/src/commands/demo.ts` (new)

Mirrors `provision.ts` (`seedOrg`/`orgReset`): each command calls `beginMutation` → `runApiScript` → parse `lastJsonLine` → `audit` → return the summary.

```ts
export interface DemoSeedResult {
  orgId: string;
  rows: number;                       // transactions target actually used
  instances: Array<{ name: string; connectorDefinitionId: string; action: "created" | "converged" | "noop" }>;
  entities: Array<{ key: string; created: number; updated: number; unchanged: number; invalid: number }>;
  toolpacks: { builtins: string[]; custom: string | null };  // slugs enabled; custom "org:<id>" or null
  googleSheets: { present: boolean };  // reported, never mutated (#511 human-connected)
  durationMs: number;
}

export async function demoSeed(
  def: EnvironmentDefinition,
  opts: { orgId: string; rows?: number },
  flags: MutateFlags,
): Promise<DemoSeedResult>;

export interface DemoResetResult {
  orgId: string;
  portalsDeleted: number;
  entities: Array<{ key: string; deleted: number; reconverged: number }>;
  durationMs: number;
}

export async function demoReset(
  def: EnvironmentDefinition,
  opts: { orgId: string },
  flags: MutateFlags,
): Promise<DemoResetResult>;
```

- `demoSeed` → `beginMutation(def, flags, /* destructive */ false)` (D4 — prod reachable with `--yes --confirm-prod`), then `runApiScript(def, "db:demo:seed", ["--org", orgId, ...(rows ? ["--rows", String(rows)] : [])])`.
- `demoReset` → `beginMutation(def, flags, /* destructive */ true)` (prod-blocked), then `runApiScript(def, "db:demo:reset", ["--org", orgId])`.
- Both parse the script's final JSON line as the result; exit codes via the existing `output.ts` map (guard failures 5/6, infra 7).

### CLI wiring — `packages/admin-cli/src/bin.ts`

A `demo` group mirroring the `seed` group (`bin.ts:256`):

```ts
const demo = program.command("demo").description("Demo-org dataset seeding");
common(demo.command("seed").requiredOption("--org <id>").option("--rows <n>", "transactions row count"))
  .action((o) => execute(o, (def) => demoSeed(def, { orgId: o.org, rows: o.rows ? Number(o.rows) : undefined }, flags(o))));
common(demo.command("reset").requiredOption("--org <id>"))
  .action((o) => execute(o, (def) => demoReset(def, { orgId: o.org }, flags(o))));
```

### `apps/api` scripts — `db/demo-seed.ts`, `db/demo-reset.ts` (new)

Mirror `seed-org.ts`: parse `--org`/`--rows`, call the service, `console.log(JSON.stringify(result))`, `closeDatabase()`, exit. Registered in `apps/api/package.json`:

```json
"db:demo:seed": "tsx src/db/demo-seed.ts",
"db:demo:reset": "tsx src/db/demo-reset.ts"
```

### `DemoSeedService` — `apps/api/src/services/demo-seed.service.ts` (new)

```ts
export class DemoSeedService {
  static async seed(params: { orgId: string; rows?: number }): Promise<DemoSeedResult>;
  static async reset(params: { orgId: string }): Promise<DemoResetResult>;
}
```

`seed()` sequence (per entity, idempotent, restartable — not one giant transaction, discovery Enterprise→Failure):

1. **Resolve the org's Sandbox instance** — `connectorDefinitions.findBySlug("sandbox")` then `connectorInstances.findByOrgDefinitionAndName(orgId, defId, "Sandbox")` (auto-provisioned at `application.service.ts:324`). File-Upload-typed instances (CSV, XLSX) are created under the `file-upload` definition (`seed.service.ts:461`) so the connector view shows the right types; `transactions` rides the Sandbox instance.
2. **For each entity** (`customers, products, sites, shipments, orders, notes, transactions`, + REST `inventory`):
   a. Ensure a **connector entity** — `connectorEntities.upsertByKey({ connectorInstanceId, organizationId, key, label })` (idempotent; unique `key` per org; `connectorInstanceId` NOT NULL).
   b. Resolve each column's **column definition id** — `columnDefinitions.findByKey(organizationId, key)` from the #508 dictionary; ensure **field mappings** via `fieldMappings.upsertByEntityAndNormalizedKey({ connectorEntityId, organizationId, columnDefinitionId, sourceField, normalizedKey, isPrimaryKey, required, refEntityKey?, refNormalizedKey? })` (conflict target `(connectorEntityId, normalizedKey)`). *(Note: `isPrimaryKey` powers the app's reference/identity features; it is **not** what `importRows` uses for `source_id` — see the row-source note below.)*
   c. **`wideTableReconcilerService.reconcileEntity(connectorEntityId, tx)`** — builds `er__<id>` + `c_*` columns (calls `ensureTable` internally); must run before `importRows` so the wide-table statement cache resolves.
   d. **`importRows(rowsAsyncIterable, { connectorEntityId, organizationId, userId })`** — row source is a CSV/XLSX reader for base entities, and `synthesizeTransactions(rows, seed, refs)` (streamed, never arrayed) for `transactions`.
3. **Toolpacks** — assign all eight built-in slugs + the #510 custom toolpack to the demo station in one call: register the custom pack in-process (the `toolpacks.router.ts:347` recipe — `generateSigningSecret()` → `ToolpackRegistrationService.fetchSchema(url)` → `validateNoBuiltinCollision` → `organizationToolpacks.create(model.parse())`, URL from config `DEMO_TOOLPACK_URL`), find/create the station (`stations.findByOrganizationId`), then `stationToolpacks.replaceForStation(stationId, { builtinSlugs: [...8], organizationToolpackIds: [customId] }, { userId }, tx)`.
4. **Report** `googleSheets.present` (never mutate OAuth instances) + the per-entity counts.

`reset()`: delete the org's portals (messages/results) + soft-delete the seeded entities' records, then call `seed()` to reconverge to the checked-in set; leave OAuth instances + tokens untouched.

**Row source (importRows contract):** `importRows` consumes `AsyncIterable<Record<string,string>>` keyed by **source field names**, assigns each row a **positional `source_id`** (`String(rowIndex++)`, `record-import.util.ts:167`), normalizes via the entity's field mappings, and dual-writes at `BATCH_SIZE = 500` in one transaction per batch (`record-import.util.ts:34,69`). Because `source_id` is positional, the readers/generator must yield rows in a **stable order** for re-seed idempotency — the committed CSV/XLSX (fixed file order) and the seeded synth (fixed seed) both do. The CSV/XLSX readers and the transaction generator yield lazily → O(batch) memory on the 512 MB task.

### Dataset relocation (D3)

- `packages/admin-cli/src/fixtures/demo-data.ts` → `apps/api/src/demo/demo-data.ts` (dependency-free; imported by both the seeder service and the generator).
- `packages/admin-cli/fixtures/demo/*.csv|xlsx` → `apps/api/fixtures/demo/*`.
- `packages/admin-cli/fixtures/demo/generate.ts` → `apps/api/src/scripts/generate-demo-fixtures.ts` (+ move the `fixtures:demo` npm script to `apps/api`).
- `packages/admin-cli/src/__tests__/demo-dataset.test.ts` → `apps/api/src/__tests__/demo-dataset.test.ts`.
- Remove `exceljs`/`tsx` from `admin-cli` devDeps if no longer used there; `apps/api` already has `exceljs`.

### Config

- `DEMO_TOOLPACK_URL` — the shared #510 endpoint base URL, read by the seeder from env/config (per env; may be the single prod URL). Registered as a catalog/SSM entry in #511's provisioning or here if the seeder needs it at seed time — **decide in plan** whether this is a new `ssm()` catalog key or a plain env read.

## Migration / Seed

**None.** #509 introduces no table and no migration. It relies on the existing per-org `column_definitions` (already seeded by `SeedService.seedSystemColumnDefinitions` at org provisioning) and existing connector/entity/record schema. If a demo column maps to a key a target org lacks, the seeder fails loudly (it does not create column definitions — that's provisioning's job).

## TDD test plan

Run via npm scripts (`feedback_use_npm_test_scripts`): `cd apps/api && npm run test:unit && npm run test:integration`; `cd packages/admin-cli && npm run test:unit`.

### Layer 1 — dataset integrity (relocated), `apps/api` unit
1. The moved `demo-dataset.test.ts` passes against the relocated fixtures/synth (row counts, join-key closure, determinism, transactions FK/lazy-stream) — unchanged assertions, new paths.

### Layer 2 — `DemoSeedService` (apps/api integration, against a test DB / e2e fixture org)
2. `seed()` on a fresh org creates the File-Upload ×… + Sandbox-borne entities with the dataset's row counts; `--json` lists each entity's `created` = its row count.
3. **Idempotency:** a second `seed()` reports every entity all-`unchanged`, zero `created`/`updated`; counts identical.
4. **Determinism at scale:** `seed({rows: N})` twice yields identical `transactions` counts (deterministic synth).
5. Field mappings + wide table exist after seed; a sampled record's `c_*` wide columns are populated (projection ran).
6. Reference columns (e.g. `orders.customer_id`) resolve to the referenced entity (ref mapping set).
7. `reset()` deletes portals + records and re-converges to the checked-in counts; a following `seed()` is all-`unchanged`.
8. `reset()` leaves a (mock) OAuth Google Sheets instance + token untouched; `seed()` reports `googleSheets.present` without mutating it.
9. **Lock-aware:** with a non-terminal job holding the instance, `seed()` reports/writes without racing (respects `ENTITY_LOCKED_BY_JOB`) — or waits, per plan.
10. Toolpacks: after seed, the station lists all eight built-ins + the custom toolpack (custom registered from the configured URL, mockable).
11. Restartability: a `seed()` interrupted after k entities, re-run, converges the rest and leaves the first k `unchanged`.

### Layer 3 — `demo.ts` CLI (admin-cli unit)
12. `demoSeed` calls `beginMutation(def, flags, false)` and spawns `db:demo:seed` with `--org` (+`--rows` when given); parses the JSON summary. (Spawn mocked.)
13. `demoReset` calls `beginMutation(def, flags, true)` → prod is blocked (exit 6) before any spawn; app-dev needs `--yes`.
14. `demo seed --env prod` without `--confirm-prod` → exit 5; with `--yes --confirm-prod` → proceeds.
15. `--json` prints the summary to stdout, banner to stderr; exit code 0 on success.

**Totals:** ~1 integrity + ~10 service integration + ~4 CLI ≈ **15 cases**.

## Acceptance criteria

- [ ] `portalai demo seed --env app-dev --org <id> --yes` yields the File Upload + REST + Sandbox-borne entities with the dataset counts; the station lists all eight built-ins + the custom toolpack; **the seeded records are visible in the connector view** (D2 — no fabricated job rows).
- [ ] A second `seed` reports every entity `unchanged` (idempotent); `seed --rows` is deterministic.
- [ ] `demo reset --env app-dev --org <id> --yes` → zero portals + checked-in counts; `--env prod` exits 6 before touching anything.
- [ ] `demo seed --env prod --org <id> --yes --confirm-prod` converges non-destructively (the documented prod refresh path).
- [ ] The seeder never mutates the Google Sheets OAuth instance; no application code special-cases the demo org.
- [ ] `npm run lint && npm run type-check && npm run test:unit` clean across touched packages; relocated integrity test green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Relocating #508's dataset breaks its integrity test / the fixtures:demo script. | Move test + generator together; run both at their new paths in slice 1 before anything depends on them. |
| ~1M `transactions` OOMs the 512 MB task. | `importRows` is O(batch)=500; the synth is a streamed generator (never arrayed); `--rows` bounds it; local defaults smaller. |
| A partial failure leaves the org half-seeded. | Per-entity convergence (not one transaction) + idempotent re-run resumes; `reset` is the clean-slate path. |
| Racing a running job → `ENTITY_LOCKED_BY_JOB`. | Check running-jobs/locks before writing; wait or report (test 9). |
| The custom-toolpack URL isn't configured at seed time. | `seed` reports the custom toolpack as skipped rather than failing the whole run; the built-ins still enable. |
| Guard misconfig runs a destructive op on prod. | `reset` is `destructive:true` (blocked on prod); `seed` is convergent/non-destructive; tests 13–14 pin the guard matrix. |

**Rollback:** `git revert` the branch; nothing schema-level to undo. On a seeded org, `demo reset` (non-prod) returns it to baseline; prod is re-converged by a corrected `seed`.

## Files touched

**`apps/api`** — new: `src/services/demo-seed.service.ts`, `src/db/demo-seed.ts`, `src/db/demo-reset.ts`, `src/demo/demo-data.ts` (moved), `fixtures/demo/*` (moved), `src/scripts/generate-demo-fixtures.ts` (moved), `src/__tests__/demo-dataset.test.ts` (moved) + `src/__tests__/demo-seed.service.test.ts`; edit: `package.json` (scripts).

**`packages/admin-cli`** — new: `src/commands/demo.ts`, `src/__tests__/demo.test.ts`; edit: `src/bin.ts`; remove: `src/fixtures/demo-data.ts`, `fixtures/demo/*`, `fixtures/demo/generate.ts`, `src/__tests__/demo-dataset.test.ts`, `fixtures:demo` script, unused devDeps.

**docs** — `packages/admin-cli/COMMANDS.md`, `docs/CLI_OPERATIONS_CHARTER.md`.

No new dependency in `apps/api` (has `exceljs`). No infra change. No schema/migration.

## Next step

`docs/DEMO_SEEDER.plan.md` — TDD slices: (1) relocate the #508 dataset into `apps/api` (move + green integrity test); (2) `DemoSeedService.seed` core for one entity end-to-end (entity→mappings→reconcile→importRows), integration TDD; (3) all base entities from CSV/XLSX; (4) streamed `transactions` at scale + `--rows`; (5) toolpacks + station assignment; (6) `reset`; (7) the `demo.ts` CLI + guards + `--json`; (8) docs. Slice 1 depends on #508 being merged into the epic (done).

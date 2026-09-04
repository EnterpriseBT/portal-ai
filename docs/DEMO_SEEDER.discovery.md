# Demo seeder (`portalai demo seed` / `demo reset`) — Discovery

**Issue:** [EnterpriseBT/portal-ai#509](https://github.com/EnterpriseBT/portal-ai/issues/509) · Feature (epic child of #507) · **full** path.

**Why this exists.** The demo org (#507) must reset to a known-good, fully-populated state before every sales demo — connector instances with parsed records, a large table that shows scale, all toolpacks on the station. Today the only fixture path (`portalai seed org` → `db:seed:org` → `ApplicationService.provisionOrganizationWorkspace`) produces an empty shell: a Sandbox instance, one station, no connector entities, no records. This child is the **re-runnable populator** that turns that shell into the demo dataset (#508) plus the custom toolpack (#510), idempotently, in every environment.

## The current shape

### The `portalai` CLI is not an API client (this reshapes the ticket's lean)

The ticket's transport lean was "authenticated calls against the running API." **That client does not exist.** `packages/admin-cli` has no `fetch`/bearer/API-base-URL seam anywhere. Commands either talk straight to Postgres through the `AdminStore` seam (`store.ts:43`, via `withStore` → `resolveEnvConnection` → drizzle) or **spawn the app's own `apps/api` npm scripts** with `DATABASE_URL` injected (`runApiScript`, `packages/cli-env/src/spawn.ts:55`). The Auth0 device-flow token (`cli-env/src/auth0.ts`) is used **only for audit attribution** (`session.ts:18`), never as an API credential.

| Piece | Location | Note |
|---|---|---|
| Command wiring + shared flags | `admin-cli/src/bin.ts:36,44,256` | `common()` adds `--env/--json/--yes/--confirm-prod`; `execute()` is the handler wrapper; a `demo` group mirrors the `seed` group. |
| Guard / mutation gate | `admin-cli/src/commands/common.ts:45` (`beginMutation`) → `cli-env/src/guard.ts:31` | `beginMutation(def, flags, destructive)` enforces app-dev `--yes`, prod-destructive-blocked, prod-mutation `--yes --confirm-prod`. |
| Spawn-a-script seam | `admin-cli/src/commands/provision.ts:78` (`seedOrg`) → `runApiScript` | The existing "run the app's real logic" pattern: `db:seed:org` runs `ApplicationService` in-process against the env DB. |
| Exit codes / audit | `admin-cli/src/output.ts:9`, `common.ts:59` | Codes 3–9; best-effort `~/.portalai/audit.log` line per mutation. |

### The server-side record-write path (what actually writes records)

- **`importRows`** (`apps/api/src/services/record-import.util.ts:69`) is the canonical streaming dual-write loop: consumes an `AsyncIterable` of rows, fetches field mappings once, normalizes + checksums, batches at 500, and per batch — in **one transaction** — does change-detection (`findBySourceIds`) then `entityRecords.upsertManyBySourceId` + `wideTable.upsertMany`. Peak memory O(batch), independent of total rows. This is the primitive the ~1M transactions ride.
- **Batch repos** (`entity-records.repository.ts:154/201/481`, `wide-table.repository.ts:219`) chunk internally at 1000/500, sized under Postgres' param cap.
- **Prereqs before records exist:** a connector **instance** (every org already has an auto-provisioned Sandbox instance, `application.service.ts:319`, `read+write`, no external source) → a connector **entity** under it → **field mappings** (sourceField → `columnDefinitionId`, with `normalizedKey`, `isPrimaryKey`) → `WideTableReconciler.ensureTable/reconcileEntity` builds `er__<id>` + `c_*` columns → then dual-write.
- **No existing script writes records** — `SeedService`/`db:seed:org` only seed schema, column definitions, instance/station/toolpack. The record-writing script is new.

### The API job paths (the alternative transport)

Fully mapped in the survey and real: file upload is `presign → confirm → parse (202 job) → layout-plans/interpret → layout-plans/commit (202 job, creates instance + records)`; REST is `create instance → create api-endpoint (+entity) → /sync (202 job)`; jobs awaited via SSE `GET /api/sse/jobs/:id/events`; toolpacks via `POST /api/toolpacks`; station toolpacks via `POST/PATCH /api/stations` `toolPacks[]`. All are JWT-gated and worker-processed. Locking: `ENTITY_LOCKED_BY_JOB` 409 while a job holds an instance — a client must await each job terminal before the next mutation.

### Cross-child state

- **#508 (dataset)** committed the synth module + fixtures under `packages/admin-cli/…` — see Decision 3; that placement was made before this discovery corrected the transport, and needs revisiting.
- **#510 (toolpack)** exposes a `demo_supply_tools` registration payload + a shared function-URL read from config; #509 consumes it, doesn't block on hosting.

## The design space

### Decision 1 — Transport

- **A. Build an HTTP API client in `portalai`** and drive the real routes/jobs above.
- **B. Spawn a new `apps/api` script** (`db:demo:seed`/`db:demo:reset`) via `runApiScript`, calling the app's **services in-process** (the `db:seed:org` pattern).
- **C. Write via the `AdminStore` DB seam** directly from the CLI.

| | A: API client | B: apps/api script | C: AdminStore |
|---|---|---|---|
| New surface | Large — HTTP client + device-token-as-credential (unproven audience) | Small — one script family, reuses services | Medium — raw SQL, reimplements app logic |
| ~1M transactions | **Impossible** (no bulk API; per-record HTTP) | `importRows` streaming ✓ | possible but bypasses normalize/wide-table |
| Real app provenance | Real BullMQ jobs ✓ | Real services (`importRows`, reconciler) ✓; no job rows | none — writes behind the app |
| Prod dependency | running API **+ Redis/workers** | **DB only** (existing tunnel) | DB only |
| Precedent | none | `provision.ts` (`seedOrg`/`orgReset`) | `org.ts`/`member.ts` |

**Lean: B.** It is the only option that handles the ~1M rows, needs only DB access in prod (no HTTP client, no Redis/worker dependency, no unproven token-as-credential), matches the existing `db:seed:org` precedent, and still writes through the app's real import/normalize/dual-write path. C is rejected (bypasses app logic — "rows behind the app's back", the exact thing the ticket forbids). A is rejected (huge new surface and it still can't do the scale table).

### Decision 2 — Record-write path & "job provenance"

The ticket's acceptance says records should "show real job provenance in the UI (the connector view lists the parse/sync jobs)." Option B calls the *services* the job processors call, so it does **not** create BullMQ `jobs` rows.

- **2a. Pure in-process import** — every entity (base CSV/XLSX + transactions) written via `importRows` under a connector entity; no `jobs` rows.
- **2b. Hybrid** — enqueue **one real `connector_sync`** for the REST instance (cheap, worker-processed → a genuine job row + genuine synced records from the live `inventory.json` URL), and in-process-import everything else. Requires Redis/worker reachable at seed time.

**Decision: 2a (confirmed 2026-09-04).** The seeder writes records directly via `importRows`; it does **not** create `jobs` rows, and that is fine. What the demo needs is the **records visible in the connector view** — which direct import gives (real `entity_records` + wide-table projection render identically to synced data). Real BullMQ job rows appear **naturally during the demo**: when the presenter runs a live REST sync or a live file upload, the records are already present and the live action produces a genuine `connector_sync`/`file_upload_parse` job on the spot — so the "jobs in the UI" story is shown live, not seeded. #509's acceptance is amended from "the connector view lists the parse/sync jobs" to "the seeded records are visible in the connector view"; no Redis/worker dependency is pulled into seeding. (The optional 2b middle-ground is dropped — unnecessary.)

### Decision 3 — Where the demo dataset lives

The seeder is a server-side `apps/api` script (Decision 1), so it must read the fixtures and import the synth. `apps/api` importing `@portalai/admin-cli` is the wrong dependency direction.

- **3a. Relocate the dataset to `apps/api`** — synth module, fixtures, generator script, integrity test all move under `apps/api`. `admin-cli` keeps only the thin `demo` command that spawns the script. Revises #508 (unmerged).
- **3b. Synth to `@portalai/core`, fixtures stay in `admin-cli`, path passed as a script arg** — both packages can import core; the script `fs`-reads the fixtures from an arg path.
- **3c. Keep in `admin-cli`; script `fs`-reads files by path and the synth is duplicated** — rejected (duplication/drift).

**Lean: 3a.** The dataset's only runtime consumer is the seeder (apps/api); the generator is authoring tooling that belongs beside the data it emits. One owner (apps/api) for data + seeding, `admin-cli` for the operator surface, is the clean seam. It revises #508, but #508 is unmerged and its smoke is at epic close — the cost is a move, not a rewrite (the module was deliberately dependency-free for exactly this).

### Decision 4 — Guard semantics

- `demo reset` → `beginMutation(def, flags, destructive=true)` — prod-blocked (exit 6), app-dev needs `--yes`. Matches `orgReset`.
- `demo seed` → **`destructive=false`** so prod is reachable with `--yes --confirm-prod` (the documented prod refresh path). This diverges from `seedOrg` (which passes `destructive=true` and is thus prod-blocked) — deliberate, because prod seeding **is** the demo-refresh mechanism (#507 acceptance).

**Lean: as above.** Seed is a convergent non-destructive mutation (prod-allowed, confirmed); reset is destructive (prod-blocked).

### Decision 5 — Idempotency / convergence

Idempotent by connector-instance/entity **name/key**. `seed` upserts by `source_id` (the committed rows carry stable ids), so a second run is a no-op in counts; the `--json` summary reports per-entity `created/updated/unchanged` and marks a converged run all-`unchanged`. `reset` deletes the org's portals (messages/results) and re-converges the seeded entities to the checked-in set, leaving OAuth instances (Google Sheets, #511) and their tokens untouched.

## Tradeoff comparison

| | B: apps/api script | 2a: in-process import | 3a: dataset in apps/api |
|---|---|---|---|
| Spread to spec | Yes — the `db:demo:*` script contract + the `demo.ts` CLI surface | Yes — the entity-provisioning + import sequence | Yes — file moves + the #508 reconciliation |

## Recommendation

1. `portalai demo seed` / `demo reset` are thin `admin-cli` commands (`demo.ts`, mirroring `provision.ts`) that `runApiScript` new `apps/api` scripts `db:demo:seed` / `db:demo:reset`.
2. The scripts provision each entity (connector entity under the Sandbox instance → field mappings from the #508 dictionary → `WideTableReconciler`) and dual-write records via `importRows` — reading committed CSV/XLSX for base entities and streaming `synthesizeTransactions` for the ~1M `transactions`.
3. Toolpacks: enable the eight built-ins + register the #510 custom toolpack (URL from config) via the in-process services, assigned to the demo station.
4. Relocate the #508 dataset (synth + fixtures + generator + integrity test) into `apps/api`; `admin-cli` keeps only the `demo` command.
5. `seed` non-destructive (prod via `--yes --confirm-prod`), `reset` destructive (prod-blocked); both idempotent/convergent with a `--json` per-entity summary; `--rows` overrides the transaction count (local defaults smaller).

## Open questions

1. ~~Amend the "job provenance" acceptance?~~ **Resolved 2026-09-04:** yes — to "the seeded records are visible in the connector view." The seeder creates no `jobs` rows; live sync/upload during the demo produces real jobs on the spot (Decision 2a).
2. ~~Relocate #508's dataset to `apps/api`?~~ **Resolved 2026-09-04:** yes (Decision 3a) — #508 is now merged under `admin-cli`; slice 1 of #509 moves the synth + fixtures + generator + integrity test into `apps/api`.
3. **Base entities via `importRows` under Sandbox, or via the real file-upload parse/commit jobs?** Lean: `importRows` under Sandbox (or per-entity connector entities) — the job-driven upload path is far more orchestration for the same durable records, and needs workers. The demo still *shows* File-Upload-typed instances if we create them under the `file-upload` definition rather than Sandbox.
4. **Local transaction scale default.** Lean: `--rows` defaults to ~1M in app-dev/prod, ~20–50k locally (the local container is unsuited to long jobs — recorded project constraint).
5. **Does the device-flow token stay audit-only?** Lean: yes — Decision 1B needs no API credential; leave the token as attribution.

## Enterprise-scale considerations

- **Concurrency & correctness** — the seeder runs single-operator, but must respect `ENTITY_LOCKED_BY_JOB`: if a real job holds the instance, `seed` waits/reports rather than racing. `importRows`' per-batch transaction + `upsertManyBySourceId` conflict target make re-runs safe. Lean: check `running-jobs`/job locks before writing.
- **Accuracy & auditability** — every mutation goes through `beginMutation` + `~/.portalai/audit.log`; the `--json` summary is the record of what converged.
- **Failure modes** — a mid-run failure leaves already-converged entities in place (idempotent), so re-running resumes; the script must be **restartable**, not all-or-nothing. Lean: per-entity convergence, not one giant transaction.
- **Scale & unbounded growth** — the ~1M path is O(batch) memory, chunked, on a 512 MB task; `--rows` bounds it. Deterministic synth → identical counts on re-seed.
- **Multi-tenancy** — targets one `--org`; no cross-org effect; nothing special-cases the demo org in application code (#507 acceptance).
- **Contract stability** — the `db:demo:*` script args + `--json` summary shape are the contract #511's runbook and the epic smoke depend on; shape them once.
- **Data lifecycle** — `reset` is the demo-cadence boundary; prod has no reset (guard-blocked), refresh is a `seed` re-run — aligned to the demo/business cadence, not a technical window.

## What this doesn't decide

- The dataset content or the synth logic (#508) — consumed, not authored here.
- The toolpack hosting/deploy (#510) — its URL is read from config.
- Org creation, the Demo tier, OAuth (Google Sheets) connection (#511) — the seeder targets an existing org and never touches OAuth instances.
- Whether to *also* drive the real BullMQ upload/sync jobs (Decision 2b) — deferred as an optional enhancement, not the core path.

## Next step

`docs/DEMO_SEEDER.spec.md` fixes the two contracts — the `demo seed`/`demo reset` CLI surface (flags, exit codes, `--json` summary schema) and the `db:demo:seed`/`db:demo:reset` script interface — plus the entity-provisioning + import sequence and the convergence/idempotency rules. `docs/DEMO_SEEDER.plan.md` then slices it: (1) relocate the #508 dataset into `apps/api`; (2) the entity-provisioning + `importRows` core for one entity, TDD; (3) all base entities + transactions streaming; (4) toolpacks + station; (5) the `demo.ts` CLI surface + guards + `--json`; (6) `reset`; (7) docs (COMMANDS.md, CLI charter). The implementation waits on #508 merging into the epic (Decision 3 relocation happens as part of slice 1).

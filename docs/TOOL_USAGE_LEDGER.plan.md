# Tool usage audit ledger — Plan

**TDD-sequenced implementation of the #179 contract: the `tool_usage_ledger` table, the transactional + idempotent write inside `commitCharge` (both call sites), the paginated org read + Settings drill-down, and the maintenance-queue retention purge with admin visibility.**

Spec: `docs/TOOL_USAGE_LEDGER.spec.md`. Discovery: `docs/TOOL_USAGE_LEDGER.discovery.md`. Issue: #179 (epic #177). Builds on #183's `commitCharge` (the single commit site), #172's `usage`/`periodIdFor`, #176's org-anchor override, and the `stripe_events` table recipe.

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/tool-usage-ledger`** (PR base: `epic/subscription-billing`) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit && npm run test:integration
cd apps/web && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:

- **Slice 1** freezes the data surface (table + model + contracts + repo + migration) — inert; nothing writes it, so the repo stays green while the shape lands. Contracts ship here (not slice 3) so slice 2's ledger-row assertions and slice 3's endpoint share one source.
- **Slice 2** is the value core: the transactional, idempotent write at both commit sites. Depends only on slice 1's shape.
- **Slice 3** reads what slice 2 writes: endpoint + sdk + Settings dialog. Independent of slice 4.
- **Slice 4** is lifecycle: the first repeatable job (purge), admin visibility, the org-delete retention pin, and the doc-sync sweep — last because it depends on the repo's `deleteOlderThan` (slice 1) and benefits from real writes existing (slice 2).

---

## Slice 1 — schema: table, model, contracts, repository, migration

The inert data surface, `stripe_events`-recipe end to end.

**Files**

- New: `packages/core/src/models/tool-usage-ledger.model.ts`, `packages/core/src/contracts/usage-ledger.contract.ts` (spec → Core model / Contracts).
- New: `apps/api/src/db/schema/tool-usage-ledger.table.ts`, `apps/api/src/db/repositories/tool-usage-ledger.repository.ts` (`insertIfNew`, `findPage`, `deleteOlderThan`).
- New (migration): `<ts>_create_tool_usage_ledger` — table + FULL unique + `(org, period)` index + CHECKs; **no backfill, no seed** (spec → Migration/Seed).
- Edit: `models/index.ts`, `contracts/index.ts`, `db/schema/index.ts`, `db/schema/zod.ts`, `db/schema/type-checks.ts`, `db/repositories/index.ts`, `services/db.service.ts`.
- New tests: core model/contract tests; `__integration__/db/repositories/tool-usage-ledger.repository.integration.test.ts`.

**Steps**

1. **Core tests (spec cases 1–2).** Entry schema round-trip; rejects `costClass: "free"` / `units: 0` / missing `toolCallId`; list query coercion + response shape. Run; fail.
2. **Author model + contracts**; export. Green 1–2. Rebuild core dist.
3. **Repo integration tests (cases 3–6).** `insertIfNew` dedup incl. concurrent double-insert; `findPage` org-scoping/filters/total/sort allow-map; `deleteOlderThan` cutoff + batch + count; CHECK probes. Run; fail.
4. **Author table + repo; generate + apply the migration**; register everywhere. Green 3–6.
5. Lint + type-check.

**Done when:** cases 1–6 pass; all pre-existing suites green; nothing writes the table yet.

**Risk:** none structural — additive only.

---

## Slice 2 — write path: context widening + transactional idempotent commit

The value core. A committed charge writes exactly one ledger row, in the aggregate's transaction, at both call sites.

**Files**

- Edit: `apps/api/src/services/cost-gate.service.ts` — `CostGateContext` + `PendingCharge` widening, `checkAdmission` context copy + UUID synthesis, `commitCharge` transaction (spec → Cost gate), `wrapWithCostGate` ctx + `options.toolCallId` extraction.
- Edit: `apps/api/src/services/tools.service.ts:720-750` — wrap ctx gains `stationId`/`portalId`.
- Edit: `apps/api/src/queues/processors/bulk-transform.processor.ts:112-117` — charge gains `toolName`/`toolCallId: job:<id>`/`stationId`/`portalId` (read from existing metadata).
- Edit tests: `__tests__/services/cost-gate.service.test.ts` (cases 7–12), the bulk-transform processor suite (case 13), `tools.service.test.ts` (wrap-wiring mock ctx additions only — fixture sweep).

**Steps**

1. **Gate tests (cases 7–12).** Same-tx pairing (repo mocks assert one shared client); skip → no insert; insert-throw → tx rejects → catch-all → resolves, nothing half-written; duplicate `toolCallId` no-op; UUID synthesis; wrap threading spies. Run; fail.
2. **Implement the widening + transaction + wrap changes.** Green 7–12 — and the untouched pre-existing gate/wrap suites stay green (the added fields are additive; `DbService.transaction` mocked as pass-through in existing tests that need it).
3. **Processor test (case 13).** Success-path charge fields incl. `portalId: null` fallback. Run; fail → thread the fields. Green.
4. Lint + type-check.

**Done when:** cases 7–13 pass; a live dev-stack metered call writes a ledger row that matches its `usage` increment (spot-check via psql, not a test).

**Risk:** existing `cost-gate.service.test.ts` mocks `DbService` without `transaction`/`toolUsageLedger` — the fixture sweep must extend the mock before the new internals run under old tests; budget slice time there.

---

## Slice 3 — read path: endpoint, sdk, Settings drill-down

**Files**

- Edit: `apps/api/src/routes/organization.router.ts` — `GET /api/organization/usage/ledger` (jobs-router template, `SORTABLE_COLUMNS`, `@openapi`), registered **before** any shadowing sibling; `config/swagger.config.ts` (+2 schemas).
- Edit: `apps/web/src/api/keys.ts` (+`organizations.usageLedger(params)`), `api/organizations.api.ts` (+`usageLedger`).
- New: `apps/web/src/components/UsageLedgerDialog.component.tsx` (container + `UsageLedgerDialogUI`).
- Edit: `apps/web/src/views/Settings.view.tsx` — "Itemized usage" button in the Subscription & Usage section.
- New tests: `__integration__/routes/organization.router.usage-ledger.integration.test.ts` (cases 14–16); `apps/web/src/__tests__/UsageLedgerDialog.component.test.tsx` + Settings extension (cases 19–20).

**Steps**

1. **Endpoint integration tests (cases 14–16).** Newest-first page + total, limit/offset; filters; unknown `sortBy` → 400; org isolation + anon rejection parity. Run; fail → implement route + swagger. Green.
2. **Web tests (cases 19–20).** Dialog UI from props (rows, pagination, empty state); Settings affordance opens the container (mocked sdk). Run; fail → implement dialog + sdk wiring + Settings button. Green.
3. Lint + type-check (both packages).

**Done when:** cases 14–16 + 19–20 pass; the dialog renders real rows against the dev stack.

**Risk:** none structural — both templates (jobs router, billing dialog) are proven on this epic.

---

## Slice 4 — retention: maintenance queue, purge, admin visibility, org-delete pin, doc-sync

The codebase's first repeatable job, deliberately introduced and observable.

**Files**

- New: `apps/api/src/queues/maintenance.queue.ts`, `apps/api/src/queues/processors/ledger-retention-purge.processor.ts`.
- Edit: worker-boot registration point (beside the jobs worker), `routes/admin.router.ts` (+`GET /maintenance`, `@openapi`), `config/swagger.config.ts` (+`MaintenanceStatusResponse`), `environment.ts` + `.env.example` (`LEDGER_RETENTION_MONTHS`), `services/organization-delete.service.ts` (retained-set comment) + its integration test (fixture ledger row + retention assertion).
- New tests: purge processor integration (case 17), admin endpoint (case 18b); org-delete extension (case 18).

**Steps**

1. **Purge tests (case 17).** Old rows gone / fresh intact / batches until drained / `{purged, batches, cutoff}` summary. Run; fail → implement queue + processor + scheduler registration + env. Green.
2. **Org-delete test (case 18).** Ledger row survives the cascade (mirror of the usage assertion). Run; fail → extend the fixture + comment. Green.
3. **Admin test (case 18b).** `GET /api/admin/maintenance` returns scheduler + last-run summary. Run; fail → implement + swagger. Green.
4. **Doc-sync sweep.** `.env.example` (done in step 1); `@openapi` on both new endpoints (slices 3–4); no glossary/FAQ change (the ledger is a Settings drill-down of an already-documented concept — extend the existing usage FAQ answer's "see what's left" sentence to mention the itemized view); no tool/prompt surfaces.
5. Lint + type-check; full per-package suites.

**Done when:** cases 17, 18, 18b pass; the scheduler shows in `/api/admin/maintenance` on a booted dev stack.

**Risk:** the repeatable-scheduler registration point must be idempotent across multi-instance boot — `upsertJobScheduler` by fixed id is, per spec; the test asserts registration is upsert-shaped (no duplicate schedulers after double-boot).

---

## Sequence summary

| # | Lands | Gate |
|---|---|---|
| 1 | Table + model + contracts + repo + migration | cases 1–6 |
| 2 | Transactional idempotent write, both commit sites | cases 7–13 |
| 3 | Endpoint + sdk + Settings dialog | cases 14–16, 19–20 |
| 4 | Purge + admin visibility + org-delete pin + doc-sync | cases 17, 18, 18b |

## Cross-slice notes

- **Core dist rebuilds** after slice 1's model/contract adds, before downstream type-checks (the branch's standing lesson).
- **`DbService.transaction` in unit mocks**: slice 2's gate tests mock it as `fn => fn(TX)` (the #176 handler-test pattern); existing gate tests need the mock key added even where unused — part of slice 2's fixture sweep.
- **Route order** for `usage/ledger` inside `organization.router.ts` (spec note) — assert via the slice-3 integration test hitting the real mounting.
- **The purge job name + scheduler id are constants** (`ledger-retention-purge`) shared by processor, registration, and the admin read — one exported const, not three strings.
- **Doc-sync inventory (CLAUDE.md)**: `.env.example`, two `@openapi` blocks, the usage FAQ answer's one-sentence extension (+pinning test). No `.tool.ts`/`system.prompt.ts`/README/CLAUDE.md changes.
- **Smoke prerequisites** (for `/smoke 179`): a metered call to write real rows (web_search prompt), `LEDGER_RETENTION_MONTHS` overridable to something tiny for a live purge demo, and the admin token for `/api/admin/maintenance`.

## Next step

Implementation starts on this branch — slice 1, tests-first, one commit per slice — once you've confirmed discovery, spec, and this plan.

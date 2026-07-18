# Tool usage audit ledger — Spec

**Issue:** [EnterpriseBT/portal-ai#179](https://github.com/EnterpriseBT/portal-ai/issues/179) · **Epic:** #177 · **Discovery:** `docs/TOOL_USAGE_LEDGER.discovery.md` · **Branch:** `feat/tool-usage-ledger` → `epic/subscription-billing`

Pin the append-only per-call charge ledger: a `tool_usage_ledger` table written **inside the same transaction** as the aggregate charge at #183's single commit site, idempotent on a stable per-call id, with an org-facing paginated read + Settings drill-down and the codebase's first recurring job for retention.

## Key decisions (ratified from discovery)

1. **D1 — transactional pair**: `commitCharge` runs `UsageService.tryCharge` and the ledger INSERT in one `DbService.transaction`; a ledger row exists iff the aggregate charge landed. A failed transaction = charge skipped = free call (#183 posture, revenue-conservative).
2. **D2 — idempotent by construction**: FULL unique on `tool_call_id` + `insertIfNew` (`stripe_events` pattern). Sync calls use the AI SDK's `toolCallId` (synthesized UUID when a non-portal caller lacks one); deferred charges use `job:<jobId>` — stable across processor retries.
3. **D3 — context rides the charge**: `CostGateContext`/`PendingCharge` widen with `toolName`, `toolCallId`, `stationId`, `portalId?`, `actor.userId` (already present). No write-time lookups.
4. **D4 — read surface**: `GET /api/organization/usage/ledger` (paginated, `periodId`/`toolName` filters, jobs-router template) + a Settings "Itemized usage" drill-down dialog.
5. **D5 — retention**: `LEDGER_RETENTION_MONTHS` (env, default 24) enforced by a **dedicated maintenance queue + BullMQ repeatable job** (daily, batched DELETE). Kept off the user-facing `jobs` table machinery — no jobs row, no SSE, no entity locks — **with operator visibility** via `GET /api/admin/maintenance` (schedulers + recent runs from BullMQ state; spec-review addition 2026-07-16).
6. **Org delete retains the ledger** like `usage` (#197 tombstone-hybrid): absent from the cascade, pinned by a retention test.
7. **OQ1 resolved by inspection**: `portalId` already rides the bulk-transform enqueue metadata (`transform-entity-records.tool.ts:714`) — the processor reads it; no enqueue change. **OQ2**: purge deletes in batches of 10,000/iteration. **OQ3**: `userId` is a ledger column.

## Scope

### In scope

1. `tool_usage_ledger` table + core model + repository (dual-schema, migration; no seed).
2. `CostGateContext`/`PendingCharge` widening; `wrapWithCostGate` ctx + `toolCallId` extraction; bulk-transform processor field threading.
3. `commitCharge` transactional pair + `insertIfNew` idempotency.
4. `GET /api/organization/usage/ledger` + contracts + OpenAPI + `sdk.organizations.usageLedger()` + Settings drill-down dialog.
5. Maintenance queue + repeatable purge job + `LEDGER_RETENTION_MONTHS` env.
6. Org-delete retention pin.

### Out of scope

- Dispute workflow UI; admission-denial audit; Stripe invoice-line linkage; archival/S3 export; backfill (impossible by nature — PRD-accepted).

## Surface

### Core model (`packages/core/src/models/tool-usage-ledger.model.ts`, new)

```ts
export const ToolUsageLedgerEntrySchema = CoreSchema.extend({
  organizationId: z.string(),
  toolName: z.string(),
  /** Stable per-call id — the AI SDK's toolCallId, `job:<jobId>` for
   *  job-deferred charges, or a synthesized UUID. The dedup key. */
  toolCallId: z.string(),
  stationId: z.string(),
  portalId: z.string().nullable(),
  /** Only charged classes appear — `free` never commits a charge. */
  costClass: z.enum(["metered", "expensive"]),
  units: z.number().int().positive(),
  periodId: z.string(),
  /** Who ran the call (dispute: "who did this"). */
  userId: z.string(),
});
```

`ToolUsageLedgerEntryModel` / `Factory` mirror `stripe-event.model.ts`; exported from `models/index.ts`.

### Drizzle table (`apps/api/src/db/schema/tool-usage-ledger.table.ts`, new)

```ts
export const toolUsageLedger = pgTable("tool_usage_ledger", {
  ...baseColumns,
  organizationId: text("organization_id").notNull().references(() => organizations.id),
  toolName: text("tool_name").notNull(),
  toolCallId: text("tool_call_id").notNull(),
  stationId: text("station_id").notNull(),
  portalId: text("portal_id"),
  costClass: text("cost_class", { enum: ["metered", "expensive"] }).notNull(),
  units: integer("units").notNull(),
  periodId: text("period_id").notNull(),
  userId: text("user_id").notNull(),
}, (t) => [
  // FULL unique — the atomic idempotency arbiter (stripe_events pattern).
  unique("tool_usage_ledger_tool_call_id_unique").on(t.toolCallId),
  index("tool_usage_ledger_org_period_idx").on(t.organizationId, t.periodId),
  check("tool_usage_ledger_cost_class_check", sql`${t.costClass} IN ('metered', 'expensive')`),
  check("tool_usage_ledger_units_positive", sql`${t.units} > 0`),
]);
```

Registered in `schema/index.ts`, `zod.ts` (`ToolUsageLedgerSelect/Insert`), `type-checks.ts` (three assignability assertions), `repositories/index.ts`, `DbService.repository.toolUsageLedger`.

### Repository (`apps/api/src/db/repositories/tool-usage-ledger.repository.ts`, new)

```ts
/** Append-only + idempotent: INSERT … ON CONFLICT (tool_call_id) DO NOTHING. */
async insertIfNew(row: ToolUsageLedgerInsert, client: DbClient = db): Promise<boolean>
/** Paginated org-scoped page + total, filterable by periodId/toolName.
 *  sortBy allow-map: created | units | toolName; default created desc. */
async findPage(organizationId: string, opts: {
  periodId?: string; toolName?: string;
  limit: number; offset: number;
  sortBy: "created" | "units" | "toolName"; sortOrder: "asc" | "desc";
}, client?: DbClient): Promise<{ entries: ToolUsageLedgerSelect[]; total: number }>
/** Retention: DELETE rows with created < cutoff, LIMIT batchSize (id-subquery
 *  batch). Returns rows deleted — the purge loops until 0. */
async deleteOlderThan(cutoffMs: number, batchSize: number, client?: DbClient): Promise<number>
```

### Cost gate (`apps/api/src/services/cost-gate.service.ts`)

`CostGateContext` (l.76-85) gains `stationId: string; portalId?: string; toolCallId?: string`. `PendingCharge` (l.98-103) gains `toolName: string; toolCallId: string; stationId: string; portalId: string | null`. `checkAdmission` copies them onto the charge, synthesizing `toolCallId ??= SystemUtilities.id.v4.generate()`.

`commitCharge` (l.210-252) — same signature, new internals after `periodId` resolution:

```ts
await DbService.transaction(async (tx) => {
  const result = await UsageService.tryCharge(
    charge.organizationId, charge.costClass, charge.units,
    alloc.unitsPerPeriod, periodId, charge.actor, tx
  );
  if (!result.allowed) return; // skipped charge → no ledger row (free call)
  await DbService.repository.toolUsageLedger.insertIfNew(ledgerRow(charge, periodId), tx);
});
```

The surrounding catch-all is unchanged: any failure → warn → the call stays free and unbroken. `wrapWithCostGate` (l.280-306): `ctx` widens to `{ organizationId, userId, stationId, portalId? }` (the wiring closure in `tools.service.ts:720-750` already has both); `execute` extracts `(options as { toolCallId?: string } | undefined)?.toolCallId` into the admission context.

### Bulk-transform processor (`apps/api/src/queues/processors/bulk-transform.processor.ts:112-117`)

The inline charge gains: `toolName: "transform_entity_records"`, `toolCallId: \`job:${jobId}\``, `stationId` (already destructured from `bullJob.data`), `portalId: bullJob.data.portalId ?? null` (already in the enqueue metadata, `transform-entity-records.tool.ts:704-722` — newly *read*, not newly written).

### Contracts (`packages/core/src/contracts/usage-ledger.contract.ts`, new)

```ts
export const UsageLedgerListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  periodId: z.string().optional(),
  toolName: z.string().optional(),
});
export const UsageLedgerListResponseSchema = z.object({
  entries: z.array(ToolUsageLedgerEntrySchema),
  total: z.number().int(),
});
```

Re-exported from `contracts/index.ts`; both registered in `swagger.config.ts`.

### Endpoint (`apps/api/src/routes/organization.router.ts`)

`GET /api/organization/usage/ledger` — any member; resolves the caller's current org (same helper as the usage read at l.570-627); parses `UsageLedgerListRequestQuerySchema`; `SORTABLE_COLUMNS` allow-map `{created, units, toolName}` per the jobs-router template (`jobs.router.ts:136-249`); returns `UsageLedgerListResponse`. Full `@openapi` block with `$ref`s + the standard pagination parameter components. **Route order:** registered before any `/:id`-style sibling so `usage/ledger` can't be shadowed.

### Retention (`apps/api/src/queues/maintenance.queue.ts` + `processors/ledger-retention-purge.processor.ts`, new)

- `MAINTENANCE_QUEUE_NAME = "maintenance"`; queue mirrors `jobs.queue.ts` connection options.
- On worker boot (beside the existing jobs worker registration): `maintenanceQueue.upsertJobScheduler("ledger-retention-purge", { pattern: "0 4 * * *" })` — daily 04:00 UTC; `upsertJobScheduler` is idempotent across instances/deploys.
- Processor: `cutoff = now − LEDGER_RETENTION_MONTHS × 30 days`; loop `deleteOlderThan(cutoff, 10_000)` until it returns 0; logs total purged. A dedicated tiny `Worker` on the maintenance queue (concurrency 1) — deliberately **not** the jobs-table wrapper (no job row, no SSE, no locks).
- `environment.ts`: `LEDGER_RETENTION_MONTHS: parseInt(process.env.LEDGER_RETENTION_MONTHS || "24", 10)`; documented in `.env.example`.

### Maintenance observability (`apps/api/src/routes/admin.router.ts`)

`GET /api/admin/maintenance` (the admin router already exists, mounted at `/api/admin` — `protected.router.ts:61`): operator-only visibility into the maintenance queue without jobs-table coupling. Returns, straight from BullMQ state:

```ts
{ schedulers: [{ id, pattern, next }],           // maintenanceQueue.getJobSchedulers()
  recentRuns: [{ name, finishedOn, returnvalue,  // last N completed/failed jobs
                 failedReason? }] }
```

The purge processor's return value is its run summary (`{ purged: number, batches: number, cutoff: string }`) so `recentRuns` carries counts with zero extra bookkeeping. `@openapi` block + a `MaintenanceStatusResponse` contract registered in `swagger.config.ts`. Structured pino logs (start/end, counts, duration) remain the primary trail.

### Org delete (`apps/api/src/services/organization-delete.service.ts`)

**No code change.** The ledger joins `usage` in the deliberately-retained set (header comment `:8-10` extended to name it); the integration suite gains a retention assertion beside the usage one (`organization-delete.service.integration.test.ts:465-472`) and the fixture seeds a ledger row.

### Web (`apps/web`)

- `api/keys.ts`: `organizations.usageLedger(params)` key. `api/organizations.api.ts`: `usageLedger(params)` via `useAuthQuery` building the query string.
- `components/UsageLedgerDialog.component.tsx` (new — container + `UsageLedgerDialogUI` per the Component File Policy): a dialog listing `toolName / costClass / units / when / who`, page controls, current-period default filter. Read-only — no form, no mutation (FormAlert/Zod form rules N/A).
- `views/Settings.view.tsx`: an "Itemized usage" button in the Subscription & Usage `PageSection` (l.193-265) opening the dialog.

## Migration

`cd apps/api && npm run db:generate -- --name create_tool_usage_ledger`: `CREATE TABLE tool_usage_ledger` + the FULL unique + `(org, period)` index + CHECKs + FK. No backfill (append-only from ship date — PRD-accepted). Rollback = drop table; data-loss acceptable pre-launch only for rows not yet billed against.

## Seed

None — the ledger has no seedable content. The integration harness needs no changes (tests seed their own rows).

## TDD test plan

Per-package npm scripts only.

### Layer 1 — core (`packages/core`, `__tests__/models/tool-usage-ledger.model.test.ts` + `__tests__/contracts/usage-ledger.contract.test.ts`)

1. Entry schema round-trips; rejects `costClass: "free"`, `units: 0`, missing `toolCallId`.
2. List request query coerces pagination + optional filters; response shape parses.

### Layer 2 — repository (`apps/api` integration, `__integration__/db/repositories/tool-usage-ledger.repository.integration.test.ts`)

3. `insertIfNew` true-then-false on the same `toolCallId`; concurrent double-insert → one row.
4. `findPage`: org-scoped, period + tool filters, total independent of page, sort allow-map honored.
5. `deleteOlderThan`: deletes only rows older than cutoff, respects batch size, returns count.
6. Schema probes: cost-class CHECK rejects `free`; units CHECK rejects 0; type-checks compile.

### Layer 3 — cost gate (`apps/api` unit, `__tests__/services/cost-gate.service.test.ts` extensions)

7. Committed charge → `tryCharge` and `insertIfNew` called with the **same tx client**; ledger row carries all charge fields + the same `periodId` given to `tryCharge`.
8. `tryCharge` not-allowed → **no** ledger insert (skip writes nothing).
9. Ledger insert throws → transaction rejects → caught by the catch-all → `commitCharge` resolves (free call), nothing half-written.
10. Duplicate `toolCallId` re-commit → `insertIfNew` false, no throw (idempotent).
11. `checkAdmission` synthesizes a UUID `toolCallId` when the context lacks one; passes through when present.
12. `wrapWithCostGate` threads `options.toolCallId` + ctx station/portal into the admission context (spy asserts).

### Layer 4 — processor (`apps/api` unit, bulk-transform processor test extensions)

13. Success-path commit carries `toolName`, `toolCallId: "job:<id>"`, `stationId`, `portalId` from job data (and `portalId: null` when metadata lacks it).

### Layer 5 — endpoint (`apps/api` integration, `__integration__/routes/organization.router.usage-ledger.integration.test.ts`)

14. Returns the org's rows newest-first with `total`; respects `limit`/`offset`.
15. `periodId` + `toolName` filters; unknown `sortBy` → 400 (allow-map).
16. Org isolation: another org's rows never appear; anon rejected (parity with protected routes).

### Layer 6 — retention + org delete (`apps/api` integration)

17. Purge processor: seeds old + fresh rows, runs, old gone / fresh intact, batches until drained; returns `{ purged, batches, cutoff }`.
18. Org delete: ledger row survives the cascade untouched (mirror of the usage retention case).
18b. `GET /api/admin/maintenance` returns the scheduler entry + a completed run's summary (BullMQ state mocked/driven in-test).

### Layer 7 — web (`apps/web`, `__tests__/UsageLedgerDialog.component.test.tsx` + Settings extension)

19. Dialog UI renders rows/pagination from props; empty state.
20. Settings shows the "Itemized usage" affordance; opens the dialog (container mounts, query fires).

**Totals ≈ 25 cases** (2 core, 4 repo, 6 gate, 1 processor, 3 endpoint, 2 retention/delete, 2 web, +migration probe folded into layer 2).

## Acceptance criteria

- [ ] All new tests pass; existing suites green; root lint + type-check clean.
- [ ] A successful metered/expensive tool call produces exactly one ledger row whose `(org, periodId, costClass, units)` matches the aggregate increment — verifiable by summing ledger rows for a period and comparing to the `usage` row.
- [ ] A denied, failed, `free`, or org-paid call writes no ledger row; a skipped commit (allocation exceeded post-hoc) writes no row.
- [ ] A completed `transform_entity_records` job writes one row (`job:<jobId>`) even across processor retries.
- [ ] `GET /api/organization/usage/ledger` pages and filters an org's own rows only; Settings shows the itemized drill-down.
- [ ] `GET /api/admin/maintenance` shows the purge scheduler and its last run summary (operator visibility without jobs-table coupling).
- [ ] Rows older than `LEDGER_RETENTION_MONTHS` are purged by the daily job; changing the env changes the window without deploy… of code beyond restart.
- [ ] Deleting an org leaves its ledger rows intact (billing record-of-truth).

## Risks & rollback

| Risk | Mitigation |
|---|---|
| Ledger write slows/breaks the charge hot path. | One INSERT inside an existing single-statement commit path; failure direction is a **free call** (catch-all), never a broken tool result — #183's revenue-conservative fail-mode extended, stated as the contract. |
| Ledger/aggregate drift. | Impossible by construction (one transaction); acceptance criterion sums the ledger against the balance. |
| Double-commit inflates the ledger. | FULL unique + `insertIfNew`; deferred ids stable across retries (`job:<jobId>`). Note: the *aggregate* increment is not deduped today (pre-existing #183 behavior) — the ledger does not worsen it and makes any such event visible/auditable. |
| Purge deletes billable evidence. | 24-month default ≫ dispute windows; window widening is an env change; batched deletes bound lock time. |
| First repeatable job misbehaves (duplicate schedulers across instances). | `upsertJobScheduler` is idempotent by scheduler id; concurrency 1; processor is a pure DELETE loop — safe to double-run by construction. |

## Files touched

**`packages/core`** — new: `models/tool-usage-ledger.model.ts`, `contracts/usage-ledger.contract.ts`; edit: `models/index.ts`, `contracts/index.ts`; tests.

**`apps/api`** — new: `db/schema/tool-usage-ledger.table.ts`, `db/repositories/tool-usage-ledger.repository.ts`, `queues/maintenance.queue.ts`, `queues/processors/ledger-retention-purge.processor.ts`, migration, tests; edit: `db/schema/index.ts`, `zod.ts`, `type-checks.ts`, `db/repositories/index.ts`, `services/db.service.ts`, `services/cost-gate.service.ts`, `services/tools.service.ts` (wrap ctx), `queues/processors/bulk-transform.processor.ts`, worker-boot registration point, `routes/organization.router.ts`, `routes/admin.router.ts`, `config/swagger.config.ts`, `environment.ts`, `.env.example`, `services/organization-delete.service.ts` (comment only) + its integration test.

**`apps/web`** — new: `components/UsageLedgerDialog.component.tsx`, tests; edit: `api/keys.ts`, `api/organizations.api.ts`, `views/Settings.view.tsx`.

## Next step

`docs/TOOL_USAGE_LEDGER.plan.md` — likely 4 slices: (1) schema + model + contracts + repo + migration (inert; cases 1–6); (2) the write path — context widening, transactional commit, both call sites (cases 7–13); (3) the read path — endpoint + sdk + Settings dialog (cases 14–16, 19–20); (4) retention + org-delete pin (cases 17–18) + doc-sync sweep.

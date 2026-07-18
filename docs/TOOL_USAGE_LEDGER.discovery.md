# Tool usage audit ledger — Discovery

**Issue:** [EnterpriseBT/portal-ai#179](https://github.com/EnterpriseBT/portal-ai/issues/179) · **Epic:** #177 · **Branch:** `feat/tool-usage-ledger` → `epic/subscription-billing`

**Why this exists.** The billing stack can say *how much* an org consumed (#172's aggregate `usage` balance) and *stop it* at the allocation (#169/#183's gate), and since #176 the spend is a real Stripe line item someone can dispute — but nothing records *which calls* consumed the units. This ticket is the itemized trail behind the aggregate: an **append-only ledger, one row per committed charge**, written from #183's single commit site. #183's bill-on-success/no-refund invariant makes it structurally simple — every row is a charge that actually landed; there are no reversal or credit entries to reconcile. This is the record-of-truth that makes chargeback, dispute resolution, per-tool analytics, and runaway-loop forensics possible.

## The current shape

### The commit site — and what it doesn't carry yet

| Touch point | File | Note |
|---|---|---|
| `PendingCharge` | `cost-gate.service.ts:98-103` | Carries **only** `organizationId, costClass, units, actor.userId`. No `toolName` (it's on `CostGateContext:76-85` but dropped), no `toolCallId`, no `portalId`/`stationId` — all needed by the ledger row. |
| `commitCharge` | `cost-gate.service.ts:210-252` | Recomputes policy + `periodId` (with the #176 org-anchor override, `:225-229`), calls `tryCharge` — and **discards its result** (`:234-241`). The landed-vs-skipped boolean is exactly the ledger's write gate. |
| Sync commit site | `wrapWithCostGate`, `cost-gate.service.ts:280-306` | Commits at `:300-301` post-success. The AI SDK's `execute(input, options)` second arg (`:289`) carries `toolCallId` — currently ignored. The wrap-wiring closure (`tools.service.ts:720-750`) knows `stationId`/`portalId`/tool name. |
| Deferred commit site | `bulk-transform.processor.ts:112-117` | Builds the `PendingCharge` inline after job success. Job metadata carries `organizationId`/`userId`/`stationId` — **no `toolCallId`, no `portalId`** today. |

### The aggregate being mirrored

`UsageService.tryCharge` (`usage.service.ts:62-102`) → `UsageRepository.chargeConditional` (`usage.repository.ts:57-95`): an atomic guarded `UPDATE … RETURNING`; success ⇔ row returned (`{allowed: true}`), a would-exceed charge returns `{allowed: false}` and writes nothing. `chargeConditional` accepts a `client` — it can run inside a caller-owned transaction.

### Recipes on the shelf

- **New table**: the `stripe_events` recipe end-to-end (#176) — model (`stripe-event.model.ts`), table with FULL unique + `insertIfNew` repository (`stripe-events.table.ts`, `stripe-events.repository.ts`), zod/type-checks registration (`zod.ts:89-97`, `type-checks.ts:170-186`), migration `0068_*`.
- **Paginated list endpoint**: `jobs.router.ts:136-249` — `PaginationRequestQuerySchema` base (`pagination.contract.ts:6-30`), a `SORTABLE_COLUMNS` allow-map, filters applied before limit/offset.
- **The usage read + Settings display**: `organization.router.ts:570-627` (`OrganizationUsageGetResponse`, unpaginated), consumed via `sdk.organizations.usage()` (`organizations.api.ts:21-24`) into `Settings.view.tsx:193-265`.
- **Org-delete retention**: `organization-delete.service.ts:250-252` deliberately leaves `usage` untouched (header `:8-10`); its integration test asserts survival (`organization-delete.service.integration.test.ts:465-472`). The ledger mirrors this — *absent* from the cascade, present in a retention test.
- **Recurring jobs: none.** `jobs.queue.ts` has no repeatable/cron machinery; every processor is event-driven. The retention purge is a **greenfield pattern**.

## The design space

### Decision 1 — Ledger write placement: transactional pair vs best-effort follow

- **A — one transaction**: `commitCharge` runs `tryCharge` + the ledger INSERT in a single `DbService.transaction`; the ledger row commits iff the aggregate increment commits. The ledger and the balance can never disagree — reconciliation-exact, which is the entire value proposition of an audit ledger.
- **B — best-effort INSERT after tryCharge**: simpler, no transaction; a ledger INSERT failure under-records while the aggregate charged. An audit trail that can silently under-record is a liability in a dispute ("your itemization doesn't sum to what you billed me").

| | A — transactional | B — best-effort |
|---|---|---|
| Ledger ≡ aggregate | **guaranteed** | drift possible |
| Call-path risk | none new (`commitCharge`'s catch-all still swallows; a failed tx = charge skipped = free call, #183 posture) | none |
| Cost | one tx per committed charge | one extra INSERT |

**Lean: A.** `chargeConditional` already accepts a client; the catch-all in `commitCharge` keeps the tool call safe; and "itemization always sums to the balance" is the property a chargeback ledger exists to have.

### Decision 2 — Idempotency: unique `toolCallId` + `insertIfNew`

`commitCharge` could double-fire (a retried job success path, a future second caller). The `stripe_events` pattern fits exactly: a FULL unique on the per-call id + `ON CONFLICT DO NOTHING`, making the ledger idempotent by construction. Requires every charge to carry a **stable** id:

- Sync tools: the AI SDK's `toolCallId` from `execute`'s options (`cost-gate.service.ts:289`) — stable per call.
- Deferred (bulk-transform): no toolCallId survives into job metadata; the **BullMQ job id does**, and is stable across processor retries. Synthesize `job:<jobId>`.

**Lean: unique(`toolCallId`) + `insertIfNew`, ids as above.** The alternative (no dedup, trust single-fire) leaves double-ledger open for exactly the retry path most likely to hit it.

### Decision 3 — `PendingCharge` context threading

The row needs `toolName`, `toolCallId`, `stationId`, `portalId?`. Two ways to get them to `commitCharge`:

- **A — widen `PendingCharge`**: `checkAdmission` already receives `toolName` on `CostGateContext`; the wrap closure knows station/portal; `execute`'s options carry `toolCallId` at commit time (passed as a new `commitCharge` arg or folded into the charge). Bulk-transform's processor builds its charge inline and has `stationId` + jobId in metadata; `portalId` is genuinely absent there → nullable column, threaded where known.
- **B — a second lookup at write time**: reconstruct context from ids — nothing to reconstruct *from*; the context only exists in the call stack.

**Lean: A.** It's the natural seam (the survey's words) and the columns go nullable only where the producer genuinely lacks the value (`portalId` on job-deferred charges; enqueue-time threading can improve later without schema change).

### Decision 4 — Query surface shape

Per the PRD gate: org-facing. Options for the endpoint:

- **A — `GET /api/organization/usage/ledger`**: paginated (`PaginationRequestQuerySchema` base), filters `periodId` + `toolName`, jobs-router template (`SORTABLE_COLUMNS` allow-map, filters before limit/offset). Sits beside the aggregate read it itemizes.
- **B — a top-level `/api/ledger` router**: more surface for no added capability.

**Lean: A.** One router already owns the org-usage read; the ledger is its drill-down. Settings gains an "Itemized usage" drill-down (dialog or expandable section) off the existing Subscription & Usage display, fed by a new `sdk.organizations.usageLedger(params)`.

### Decision 5 — Retention purge scheduling (greenfield)

PRD gate answer: env-config window, default 24 months, periodic purge. No recurring-job machinery exists. Options:

- **A — BullMQ repeatable job** (`upsertJobScheduler`): first-class recurring pattern on the existing queue; new pattern to the codebase but the queue/worker/processor plumbing all exists; observable through the standard jobs surface.
- **B — opportunistic purge-on-write**: piggyback a `DELETE … WHERE created < cutoff LIMIT n` on some existing periodic activity — there isn't one; charges are bursty and org-scoped, making sweep timing erratic.
- **C — external scheduler** (ECS scheduled task / cron invoking a CLI): splits the mechanism across repos/infra; heavier ops for a table-local DELETE.

| | A — BullMQ repeatable | B — on-write | C — external |
|---|---|---|---|
| Uses existing infra | **yes (queue exists)** | yes | no |
| Deterministic cadence | **yes** | no | yes |
| New pattern cost | repeatable-job registration | hidden coupling | infra + repo split |

**Lean: A.** One repeatable job (`ledger_retention_purge`, daily), batch-deleting rows older than `LEDGER_RETENTION_MONTHS` (default 24). It introduces the repeatable pattern deliberately, documented, in the jobs surface where every other background work already lives.

## Tradeoff comparison

| | D1 transactional pair | D2 unique toolCallId | D3 widen PendingCharge | D4 usage/ledger endpoint | D5 BullMQ repeatable |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| New pattern | No | No (stripe_events) | No | No (jobs router) | **Yes — first recurring job** |

## Recommendation

1. `tool_usage_ledger` table (dual-schema, `stripe_events` recipe): `baseColumns` + `organizationId` (FK), `toolName`, `toolCallId` (FULL unique), `stationId`, `portalId` (nullable), `costClass` (CHECK), `units` (CHECK > 0), `periodId`; indexed `(organizationId, periodId)` for the list read.
2. Widen `PendingCharge` with `toolName`, `toolCallId`, `stationId`, `portalId?`; the sync wrap fills them from its closure + `execute` options; bulk-transform fills from job metadata with `toolCallId = "job:" + jobId`.
3. `commitCharge` surfaces `tryCharge`'s result and, when `allowed`, INSERTs the ledger row **in the same transaction** as the conditional charge (`chargeConditional(client)`); `insertIfNew` on `toolCallId` makes double-commit a no-op. The existing catch-all keeps every failure a free call, never a broken one (#183 posture).
4. `GET /api/organization/usage/ledger` — paginated + `periodId`/`toolName` filters, jobs-router template; new `UsageLedgerListResponse` contract; Settings drill-down via `sdk.organizations.usageLedger()`.
5. Retention: `ledger_retention_purge` BullMQ repeatable job, daily, batch DELETE older than `LEDGER_RETENTION_MONTHS` (env, default 24) — the codebase's first repeatable job, registered alongside the existing worker.
6. Org delete: the ledger is **retained** like `usage` — absent from the cascade, mirrored retention test beside `organization-delete.service.integration.test.ts:465-472`.

## Open questions

1. **Does the deferred (bulk-transform) charge's ledger row carry the *enqueueing* portal?** `portalId` isn't in job metadata; threading it at enqueue is a one-field addition to the job payload but touches the transform tool's enqueue path. **Lean:** thread it now (nullable column either way) — the enqueue site already builds metadata, and forensics ("which portal ran this loop") is a named use case.
2. **Is the purge's `DELETE` batched or one statement?** A 24-month cutoff on a large table in one DELETE can lock/bloat. **Lean:** batched (`LIMIT`-style loop per run, e.g. 10k/iteration) — boring and safe; the spec pins the batch size as a constant.
3. **Does the ledger row record `actor.userId`?** `PendingCharge` carries it; a dispute wants "who ran it". **Lean:** yes — `userId` column (it's already in every charge; omitting it now means a schema change the first time support asks).

## Enterprise-scale considerations

- **Concurrency & correctness** — the ledger INSERT shares the aggregate charge's transaction (D1) and dedups on a stable per-call id (D2); double-commit, retry, and multi-instance races all collapse to one row. **Lean:** transactional + idempotent, as specced.
- **Accuracy & auditability** — this ticket *is* the auditability dimension: append-only, no reversals (#183 invariant), itemization provably sums to the billed aggregate because both commit together. **Lean:** the D1 transaction is non-negotiable.
- **Failure modes** — ledger path failure ⇒ the whole commit rolls back ⇒ the call stays free (never mischarged, never half-recorded); `commitCharge`'s catch-all keeps the tool result unaffected. Fail direction is *revenue-conservative*, consistent with #183. **Lean:** accept the (rare) free call over a books-vs-balance mismatch.
- **Scale & unbounded growth** — append-only by design ⇒ retention is a first-class deliverable (D5), reads are paginated with an `(org, period)` index, and the purge is batched (OQ2). **Lean:** as specced.
- **Multi-tenancy** — rows are org-scoped; the read endpoint resolves the caller's org exactly like the aggregate read. **N/A beyond that.**
- **Contract stability** — the list contract is a standard paginated envelope; per-row shape mirrors the table so future columns (e.g. Stripe invoice-line linkage) are additive. **Lean:** whole-row objects, not a bespoke projection.
- **Data lifecycle** — rows key to `periodId` (business period, #172/#176 anchored), retention is a contract-semantic window (months, not technical days), org-delete retains per the billing record-of-truth rule (#197). **Lean:** as specced.

## What this doesn't decide

- **Dispute/chargeback workflow UI** — the ledger is the evidence, not the process; a dispute flow is its own future ticket.
- **Admission-denial audit** (why a call was blocked) — observability, explicitly out of scope per the PRD.
- **Stripe invoice-line reconciliation** — additive column when metered Stripe billing exists; v1 is flat subscriptions.
- **Archival tier (S3 export)** — PRD gate chose purge-only; archival machinery waits for a compliance requirement.
- **Backfill** — impossible by nature (accepted in the PRD); the ledger records from ship-date forward.

## Next step

`docs/TOOL_USAGE_LEDGER.spec.md` (columns/constraints, the widened `PendingCharge`, transactional commit semantics, endpoint contract, purge job shape) then `docs/TOOL_USAGE_LEDGER.plan.md` — likely 4 slices: (1) schema + model + repo + migration (inert); (2) the write path — `PendingCharge` widening, transactional commit, both call sites, idempotency; (3) the read path — endpoint + contract + Settings drill-down; (4) retention — the repeatable-job pattern + purge processor + org-delete retention test.

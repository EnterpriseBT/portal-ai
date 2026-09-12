# Security audit log — Plan

**TDD-sequenced implementation of the append-only audit log: the contract + schema + migration, the `AuditLogRepository` + fail-open `AuditService`, the owner-gated read endpoint, the emission wiring at the security seams, and the retention purge.**

Spec: `docs/AUDIT_LOG.spec.md`. Discovery: `docs/AUDIT_LOG.discovery.md`. Issue: #575 (epic #578). Modeled on the shipped tool-usage ledger (#179) — the near-exact append-only precedent (`tool-usage-ledger.{model,table,repository}.ts`, `ledger-retention-purge.processor.ts`), all live on `main`/the epic base.

Five slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/audit-log`** (base `epic/security-readiness`, PR #595) — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/core && npm run test:unit
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — contract + storage first, then read, then emission, then housekeeping:

- **Slice 1** — the contract: core model + Zod, the Drizzle table, dual-schema type-checks, the migration (incl. the tamper-evidence **trigger** — Open Q2 resolved to a trigger, not a REVOKE, since the app owns the table). Pure leaf; everything else imports these types.
- **Slice 2** — the `AuditLogRepository` + the fail-open `AuditService`, unit-tested; carries the trigger-holds integration test (needs `append` to seed a row first). No emission yet.
- **Slice 3** — the owner-gated read endpoint + `ApiCode`s + OpenAPI. Depends only on slice 2's `findPage`; the integration test seeds rows via the repo directly, so read correctness is verified **independent of** emission.
- **Slice 4** — `trust proxy` + the audit-context helper + the webhook payload extension + `AuditService.record` calls at every seam. The emission integration test proves a real seam writes a row **and** that the audited action still succeeds when the audit write fails (fail-open end-to-end).
- **Slice 5** — the retention purge processor + queue/worker/env, cloned from the ledger purge. Independent housekeeping, last.

The migration lands in slice 1 (`0094_add-audit-log-table`, incl. the append-only trigger); every later integration test relies on it being applied by the test DB's migration run.

---

## Slice 1 — Contract + schema + migration

The append-only table and its dual-schema types. Nothing writes or reads it yet.

**Files**

- New: `packages/core/src/models/audit-log.model.ts` — `AUDIT_ACTIONS`, `AuditActionSchema`, `AuditOutcomeSchema`, `AuditLogEntrySchema` (`CoreSchema.extend`), `AuditLogEntryModel`, `AuditLogEntryModelFactory` (mirror `tool-usage-ledger.model.ts`).
- New: `packages/core/src/contracts/audit-log.contract.ts` — `AuditLogListRequestQuerySchema`, `AuditLogListResponseSchema` + types.
- New: `apps/api/src/db/schema/audit-log.table.ts` — `auditLog` `pgTable` (spec §3): `baseColumns` + org FK + `userId`/`action`/`targetType`/`targetId`/`outcome`/`sourceIp`/`userAgent`/`metadata` (jsonb), `(organizationId, created, id)` index, outcome check. No unique idempotency key.
- New: `apps/api/drizzle/0094_add-audit-log-table.sql` — generated, then hand-append the `audit_log_prevent_mutation` trigger (blocks UPDATE always, DELETE unless `app.audit_retention_purge='on'`).
- Edit: `packages/core/src/models/index.ts`, `packages/core/src/contracts/index.ts`, `apps/api/src/db/schema/index.ts`, `apps/api/src/db/schema/zod.ts` (`AuditLogSelect`/`Insert`), `apps/api/src/db/schema/type-checks.ts` (bidirectional `IsAssignable` + `InferSelectModel`).
- New tests: `packages/core/src/models/__tests__/audit-log.model.test.ts`, `packages/core/src/contracts/__tests__/audit-log.contract.test.ts`.

**Steps**

1. **Tests (spec: core model ~7, contract ~4).** Model: valid entry parses; unknown `action` rejected; bad `outcome` rejected; nullable `targetType`/`targetId`/`sourceIp`/`userAgent`/`metadata`; factory `create(createdBy)` stamps base fields. Contract: query defaults `sortOrder='desc'`; optional `action`/`outcome` parse; response shape. Run; fail.
2. **Implement** the model, contract, table, zod entries, type-checks. Generate the migration (`npm run db:generate -- --name add-audit-log-table`) and hand-append the trigger. Green.
3. Lint + type-check (the dual-schema guard in `type-checks.ts` is a compile-time assertion — `type-check` is its test).

**Done when:** the core model + contract cases pass; `type-check` passes (dual-schema guard holds); the migration applies cleanly. Nothing references the table at runtime yet.

**Risk:** the jsonb `metadata` dual-schema mapping — mirror `connector-instances.config` (`z.record(z.string(), z.unknown()).nullable()` ↔ `jsonb(...).$type<Record<string,unknown>>()`), which the type-check confirms. **Tamper-evidence mechanism** (spec Open Q2): resolved to a trigger — the app connects as the table owner, so `REVOKE` is a no-op, and a blanket block would break the slice-5 purge. The trigger blocks UPDATE always and DELETE unless the purge sets `app.audit_retention_purge='on'`. Also: import `AUDIT_ACTIONS` from `@portalai/core/models`, not the root barrel (drizzle-kit's tsx loader chokes on the root barrel's SVG assets).

---

## Slice 2 — `AuditLogRepository` + fail-open `AuditService`

The append-only repo and the central emission service, unit-tested. Carries the tamper-evidence integration proof.

**Files**

- New: `apps/api/src/db/repositories/audit-log.repository.ts` — `AuditLogRepository` with `append`, `findPage`, `deleteOlderThan` (each purge batch sets `SET LOCAL app.audit_retention_purge='on'` so the trigger permits it), `SORTABLE_COLUMNS`/`AUDIT_LOG_SORT_KEYS` (spec §6); no update/delete surface. `auditLogRepo` singleton.
- New: `apps/api/src/services/audit.service.ts` — `AuditService.record(event)` + `AuditEvent` (spec §7): fail-open try/catch, `error` log + failure counter, default `outcome='success'`, actor = `createdBy`.
- Edit: `apps/api/src/services/db.service.ts` — register `auditLog: auditLogRepo`.
- New tests: `apps/api/src/services/__tests__/audit.service.test.ts`; `apps/api/src/db/repositories/__tests__/audit-log.repository.test.ts`; a trigger-holds assertion in the repo integration test.

**Steps**

1. **Unit tests (spec: repo ~7, service ~6).** Repo: `append` inserts; `findPage` org-scopes, filters by `action`/`outcome`, orders newest-first with `id` tiebreaker, returns total; `deleteOlderThan` batch-deletes by cutoff. Service: `record` writes a row with actor/action/target/outcome/ip/ua; **fail-open** — when `append` throws, `record` resolves (no throw) and logs at `error` + bumps the counter; defaults `outcome='success'`. Run; fail.
2. **Integration test (spec: tamper-evidence ~1).** `append` a row, then attempt a raw `UPDATE` and an unflagged `DELETE` through the app connection — assert both are rejected (the trigger raises); assert a `SET LOCAL app.audit_retention_purge='on'` DELETE succeeds. Run; fail.
3. **Implement** the repo (mirror the ledger repo; `findPage` appends `auditLog.id` to `orderBy`) + the service (fail-open wrap) + the DbService registration. Green.
4. Lint + type-check.

**Done when:** repo + service unit cases pass; the trigger-holds integration assertion passes. `AuditService.record` is callable but not yet called from any seam.

**Risk:** the failure counter's durability (spec §7) — a module-level counter + a distinct `error` log code is the floor; wiring it to a metrics/health surface is optional and can be confirmed with the user (spec Key decision 3). The trigger test must use the **app** DB connection; the trigger fires for any role, so this is naturally correct.

---

## Slice 3 — Owner-gated read endpoint

The read surface. Verified by seeding rows via the repo — decoupled from emission.

**Files**

- Edit: `apps/api/src/routes/organization.router.ts` — `GET /api/organization/audit-log` (spec §11): `getApplicationMetadata` guard, query parse + `AUDIT_LOG_SORT_KEYS` check → `400 AUDIT_LOG_INVALID_QUERY`; **owner gate** (`organization.ownerUserId !== userId → 403 AUDIT_LOG_NOT_AUTHORIZED`); `auditLogRepo.findPage` → `AuditLogListResponse`; `500 AUDIT_LOG_FETCH_FAILED`. `@openapi` block.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — `AUDIT_LOG_INVALID_QUERY`, `AUDIT_LOG_FETCH_FAILED`, `AUDIT_LOG_NOT_AUTHORIZED`.
- Edit: `apps/api/src/config/swagger.config.ts` — register `AuditLogEntry` + `AuditLogListResponse` (`z.toJSONSchema`).
- New test: `apps/api/src/__tests__/__integration__/routes/audit-log.router.integration.test.ts`.

**Steps**

1. **Integration tests (spec: read ~6).** Seed rows via `auditLogRepo.append`. Owner gets a page; **non-owner member → 403 `AUDIT_LOG_NOT_AUTHORIZED`**; invalid `sortBy` → `400`; org-scoping (org A cannot see org B's rows); pagination + total; `action`/`outcome` filter. Run; fail.
2. **Implement** the endpoint + `ApiCode`s + OpenAPI registration. Green.
3. Lint + type-check.

**Done when:** the read cases pass; an owner can page/filter their org's trail; a non-owner is denied; org isolation holds. The one-line owner predicate is the seam #576 later swaps.

**Risk:** the owner gate needs the org row (`organizations.findById`) — a soft-deleted org still returns via `findById`? Confirm the read still works for a tombstoned org's owner (rows persist past org delete, spec AC). If `findById` excludes soft-deleted, use an include-deleted read for the owner lookup here.

---

## Slice 4 — `trust proxy` + emission wiring at the seams

The log goes live. After this slice, security actions produce rows.

**Files**

- Edit: `apps/api/src/app.ts` — `app.set("trust proxy", <hop count>)` (spec §9).
- New/Edit: `apps/api/src/utils/audit-context.util.ts` (or extend `request-context.util.ts`) — `auditContextFromRequest(req)` (spec §8).
- Edit: `packages/core/src/contracts/webhook.contract.ts` — optional `ip`/`user_agent` on `Auth0PostLoginWebhookPayloadSchema` (spec §12).
- Edit (emission, spec §10): `apps/api/src/services/webhook.service.ts` (`auth.login`), `application.service.ts` (`org.create`, `member.switch`), `organization-delete.service.ts` (`org.delete`, `member.remove`), the member-add site, `connector-instance.router.ts` (`connector.credential.create`/`.update`), sync kickoff (`connector.credential.access`), `toolpacks.router.ts` (`toolpack.secret.rotate`), `connector-entity.router.ts` + connector export handlers (`data.export`/`data.delete`).
- New test: `apps/api/src/__tests__/__integration__/services/audit-emission.integration.test.ts`.

**Steps**

1. **Integration tests (spec: emission ~3).** A representative seam (e.g. `org.delete` and `toolpack.secret.rotate`) produces an `audit_log` row with the right actor/target/outcome; and the audited action **still succeeds when the audit write is forced to fail** (fail-open, end-to-end). Run; fail.
2. **Implement** `trust proxy`, the context helper, the webhook payload extension, and the `void AuditService.record({...})` calls at each seam — **after** the action's own success, never inside its transaction. Green.
3. Lint + type-check.

**Done when:** the emission cases pass; the representative seams write rows; forcing an audit failure does not fail the action. `sourceIp` is the real client IP via `trust proxy`.

**Risk:** **broadest slice** — it touches ~8 seams. The calls are mechanically identical (`auditContextFromRequest` + `AuditService.record`), but each must sit post-commit. If review finds it unwieldy, split into 4a (identity/org: auth/org/member) and 4b (resources: connector/toolpack/data) — same tests, two commits. **`trust proxy`** (spec Risk): pin the hop count to the real ALB+CloudFront chain; verify #574's rate-limit keying is unaffected (it keys per-user). The Auth0 Action forwarding `event.request.ip` is an infra config step — the code accepts absent → null, so it's not a code blocker.

---

## Slice 5 — Retention purge

Daily housekeeping, cloned from the ledger purge. Independent, last.

**Files**

- New: `apps/api/src/queues/processors/audit-log-retention-purge.processor.ts` — mirror `ledger-retention-purge.processor.ts`: `AUDIT_LOG_PURGE_BATCH_SIZE`, `AuditLogRetentionPurgeSummary`, window `environment.AUDIT_LOG_RETENTION_MONTHS`, drain loop over `auditLogRepo.deleteOlderThan`.
- Edit: `apps/api/src/queues/maintenance.queue.ts` — `AUDIT_LOG_RETENTION_PURGE_JOB = "audit-log-retention-purge"` + scheduler entry (`{ pattern: "30 5 * * *" }`).
- Edit: `apps/api/src/queues/maintenance.worker.ts` — dispatch the new job name.
- Edit: `apps/api/src/environment.ts` — `AUDIT_LOG_RETENTION_MONTHS` (default 24).
- Edit (doc-sync): `apps/api/README.md` — the new env var + the audit-log feature/endpoint + maintenance job.
- New test: `apps/api/src/__tests__/__integration__/queues/audit-log-retention-purge.integration.test.ts`.

**Steps**

1. **Integration tests (spec: retention ~3).** Rows older than the window are purged; newer retained; summary shape `{purged, batches, cutoff}` correct. Run; fail.
2. **Implement** the processor + queue const + scheduler + worker dispatch + env var. Green.
3. Update `apps/api/README.md` (doc-sync). Lint + type-check.

**Done when:** the purge cases pass; the scheduler is registered (visible in `GET /api/admin/maintenance`); the env var is documented.

**Risk:** none beyond the ledger purge's — a pure DELETE loop, safe to double-run under the maintenance worker's `concurrency: 1`.

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | core model + contract + table + zod + type-checks + migration (trigger) | model ~7, contract ~4 | core unit + type-check |
| 2 | `AuditLogRepository` + fail-open `AuditService` + trigger-holds | repo ~7, service ~6, tamper ~1 | api unit + integration |
| 3 | owner-gated read endpoint + `ApiCode`s + OpenAPI | read ~6 | api integration |
| 4 | `trust proxy` + context helper + webhook ext + emission at seams | emission ~3 | api integration |
| 5 | retention purge + queue/worker/env + README | retention ~3 | api integration |

Total ≈ **37 cases**, one migration (slice 1). Commits on `feat/audit-log`; PR #595 grows commit-by-commit.

## Cross-slice notes

- **Migration lands in slice 1**, and every later integration slice (2–5) depends on the test DB having applied it (incl. the trigger). Open Q2 (REVOKE vs trigger) is decided at slice 1 — a trigger, since the app owns the table.
- **Read before emission is deliberate** (slices 3 → 4): the read is verified by directly-seeded rows, so read correctness never depends on emission correctness, and vice-versa.
- **Fail-open is the through-line** — asserted at the unit level in slice 2 (`record` swallows) and end-to-end in slice 4 (a seam's action survives an audit-write failure). Both are required; the spec's central safety property.
- **`trust proxy` (slice 4) is a global config touch** shared with #574 — verify its per-user rate-limit keying is unaffected (it is; it keys on the principal, not IP).
- **Doc-sync (per `CLAUDE.md` → "Keeping Documentation in Sync"):** the OpenAPI surface lands with the endpoint (slice 3); the new env var + feature note update `apps/api/README.md` in slice 5. No user-facing Help/glossary surface (the in-app view is #596, a separate ticket). CLAUDE.md's DB-schema workflow already covers the table-add; no convention change needed.
- **CLAUDE.md compliance:** file suffixes (`*.model.ts`, `*.table.ts`, `*.repository.ts`, `*.service.ts`, `*.contract.ts`, `*.processor.ts`), dual-schema type-checks, `@openapi` on the new route, and the server-enforced (not prompt-enforced) tamper-evidence all hold.

## Next step

Implement slice 1 on `feat/audit-log`, tests-first — the core model + contract + table + type-checks + migration — only after discovery + spec + plan are confirmed. Lift the model/table/repo skeletons from the shipped ledger; the spec's Surface is faithful to them.

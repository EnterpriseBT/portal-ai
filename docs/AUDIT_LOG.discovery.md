# Security audit log — Discovery

**Issue:** [EnterpriseBT/portal-ai#575](https://github.com/EnterpriseBT/portal-ai/issues/575) (epic [#578](https://github.com/EnterpriseBT/portal-ai/issues/578), branch `epic/security-readiness`)

**Why this exists.** There is no tamper-evident, append-only trail of security-relevant activity — logins, org/member/role changes, credential create/update/access, secret rotation, admin operations, data export/delete. The tool-usage ledger (#179) records *billing* itemization, not security events. This is the single biggest SOC 2 gap and a direct enterprise-buyer ask, and it is a SaaS win in its own right (customers expect a visible activity log).

The good news: the tool-usage ledger is a **near-exact structural precedent** — an append-only, org-scoped table retained past org-delete, with an owner-facing paginated read and a batched retention purge. This ticket is the *security* sibling of that billing table: `audit_log` is the append-only record-of-truth that captures who did what, to what, from where, and whether it succeeded.

## The current shape

### Dual-schema table pattern (the five pieces)

The ledger (#179) is the concrete recent example with all five:

| Piece | Location | Note |
|---|---|---|
| Core model | `packages/core/src/models/tool-usage-ledger.model.ts` | `CoreSchema.extend` (`base.model.ts:16`) + `CoreModel<T>` + `ModelFactory.create(createdBy)` (`base.model.ts:73`); exported from `packages/core/src/models/index.ts` |
| Drizzle table | `apps/api/src/db/schema/tool-usage-ledger.table.ts` | `pgTable(..., {...baseColumns, ...}, t => [indexes])`; `baseColumns` at `apps/api/src/db/schema/base.columns.ts:100`; registered in `schema/index.ts` |
| drizzle-zod | `apps/api/src/db/schema/zod.ts:101-111` | `createSelectSchema`/`createInsertSchema` + inferred `*Select`/`*Insert` |
| Type guards | `apps/api/src/db/schema/type-checks.ts:193-215` | bidirectional `IsAssignable` + `InferSelectModel` round-trip, asserted `= true` |
| Migration | `apps/api/drizzle/` (numbered SQL) | config `apps/api/drizzle.config.ts` |

### Base Repository + append-only feasibility

`apps/api/src/db/repositories/base.repository.ts` — `Repository<TTable, TSelect, TInsert>`. Reads exclude soft-deleted via `notDeleted()` (`isNull(cols.deleted)`, ~109) folded by `withSoftDelete()` (~117); `findMany` (~145, `ListOptions` with `organizationId` scoping, keyset #433), `create`/`createMany` (~195). An **append-only** audit repo subclasses `Repository` and deliberately exposes only `create` + org-scoped reads (`findPage`) + a `deleteOlderThan` batch for retention — it does **not** surface `update`/`softDelete`/`hardDelete` on the public method set. The ledger repo already is exactly this shape.

### The ledger repo — the pattern to copy

`apps/api/src/db/repositories/tool-usage-ledger.repository.ts`: `insertIfNew` (onConflictDoNothing on the idempotency key, ~46), `findPage` (org-scoped page + total + a `SORTABLE_COLUMNS` allow-map, ~62), `deleteOlderThan` (batched id-subquery delete, ~120). The table is append-only (no reversal/update rows), FULL-unique on `tool_call_id`, `org_period_idx` for reads. Written inside `CostGateService.commitCharge`.

### Retention / purge

`apps/api/src/queues/processors/ledger-retention-purge.processor.ts` — batch-drain loop (`PURGE_BATCH_SIZE = 10_000`, calls `deleteOlderThan` until 0), env window `LEDGER_RETENTION_MONTHS`, returns `{purged, batches, cutoff}`. Registered in `apps/api/src/queues/maintenance.queue.ts` (`registerMaintenanceSchedulers`, cron `0 4 * * *`), dispatched by `maintenance.worker.ts` (`concurrency: 1`), surfaced by `GET /api/admin/maintenance` (`apps/api/src/routes/admin.router.ts:213`).

### Emission seams (where each event originates)

| Event class | Hook point |
|---|---|
| Login | `POST /api/webhooks/auth0/sync` (`webhook.router.ts:115`) → `webhook.service.ts` (`post_login` / `post_user_registration`) |
| Org create | `ApplicationService.createOrganizationForEmail` (`application.service.ts:157`) |
| Org delete/tombstone | `organization.router.ts` `DELETE /:id` (owner check ~286) → `organization-delete.service.ts` (memberships soft-deleted, usage/ledger retained, ~257) |
| Member switch / add / remove | `POST /organization/switch` (~490) → `application.service.ts:94`; add/remove via `organizationUsers` repo in the create/delete services |
| Connector credential create/update | `connector-instances.repository.ts` `create`/`update` (encrypt on write ~112-126); routes `connector-instance.router.ts` (~604) |
| Connector credential **access** | `connector-instances.repository.ts` `decryptRow`/`decryptRows` on **every read** (~46-59) — see Decision 4 (this is a hot path) |
| Toolpack secret rotation | `toolpacks.router.ts:762` `POST /:id/rotate-signing-secret` |
| Data export / delete | no single GDPR endpoint — `connector-entity.router.ts:909` (cascade delete), `entity-record-clear.processor.ts`, org delete (above); export via the connector routers + `portal-sql-handle.router.ts` |

### Request context: actor + IP + agent

Two-stage auth: `jwtCheck` (`auth.middleware.ts`, → `req.auth.payload`) then `getApplicationMetadata` (`metadata.middleware.ts`) attaches `req.application.metadata = { userId, organizationId }` — the **actor + org** every route reads. An AsyncLocalStorage store exists (`request-context.middleware.ts` + `request-context.util.ts`) but currently carries only the pino logger. **Source IP / user-agent are not threaded to the service layer** — read `req.ip` / `req.get('user-agent')` at the route. Critically, **`app.ts` sets no `trust proxy`**, so behind the ALB/CloudFront `req.ip` is the proxy hop, not the client (see Decision 5).

### Read API surface + org-owner identification

Representative: `GET /api/organization/usage/ledger` (`organization.router.ts:715`) — `getApplicationMetadata` guard, Zod query parse, `sortBy` validated against a repo allow-map, `repo.findPage(organizationId, {...})`, returns `{entries, total}`. **Org owner is a first-class column:** `organizations.ownerUserId` (`packages/core/src/models/organization.model.ts:19`, migration `0005`); the owner-gate pattern is `organization.ownerUserId !== userId → 403 ORGANIZATION_NOT_OWNER` (`organization.router.ts:286`). Membership join is `organization_users` (`organization-user.model.ts`).

### OpenAPI + api-codes

New `ApiCode` members → `apps/api/src/constants/api-codes.constants.ts` (ledger's `USAGE_LEDGER_INVALID_QUERY`/`_FETCH_FAILED` at 650-652 are the model; default text at `ApiCodeDefaultRecommendation` ~684). `@openapi` JSDoc above the handler + Zod→`z.toJSONSchema` component registration in `apps/api/src/config/swagger.config.ts` (ledger schemas ~368-377).

## The design space

### Decision 1 — Emission mechanism (transactional coupling)

The fail-open requirement forces the answer. If the audit `INSERT` joins the same DB transaction as the audited action (e.g. org create/delete), a failed audit **rolls back the action** — that is fail-*closed*. So the audit write must be a **separate write, after the action commits**, wrapped best-effort.

| | A. In-transaction with the action | B. Post-commit best-effort | C. Enqueue to a BullMQ job |
|---|---|---|---|
| Fail policy | fail-closed (audit failure kills the action) | fail-open (matches the decided posture) | fail-open, but adds Redis as a dependency of every audited action |
| Gap window | none | tiny (action committed, audit write failed → logged loudly) | larger (job could be lost if Redis is down at enqueue) |
| Complexity | low | low | high (worker, serialization, more moving parts) |

**Lean: B.** Emit *after* the action succeeds, via a central service (Decision 2), wrapped in try/catch that logs at `error` + sets a degradation marker. This is exactly the fail-open-with-loud-gap posture chosen in the PRD gate. Reject C — a queue makes audit availability depend on Redis and adds a lossy hop for no gain.

### Decision 2 — Central `AuditService` vs inline inserts

**Lean: a central `AuditService.record(event)`** (static-method service per the API style guide). One place owns the fail-open wrapping, actor/IP/agent shaping, and the typed action taxonomy. Seams call `AuditService.record({...})` with the structured event; they never touch the repo directly.

### Decision 3 — Action taxonomy: typed enum vs free-form strings

| | A. Typed union of action codes in core | B. Free-form action strings |
|---|---|---|
| Queryability / stability | strong — a contract the read API + tests assert against | weak — typos are silent, no enum to filter by |
| Extensibility | add a member (one line) | anything goes |

**Lean: A.** A typed `AuditAction` union in `@portalai/core` (e.g. `auth.login`, `org.create`, `org.delete`, `member.add`, `member.remove`, `member.switch`, `connector.credential.create`, `connector.credential.update`, `connector.credential.access`, `toolpack.secret.rotate`, `data.export`, `data.delete`), with structured `targetType` + `targetId` + an `outcome` (`success`/`failure`) + a small JSON `metadata` bag. Contract stability — the read filter and every emission test key off the enum.

### Decision 4 — Credential-access granularity (the unbounded-growth risk)

`decryptRow`/`decryptRows` fires on **every** connector-instance read — every list query decrypts. Auditing each decrypt would emit an audit row per API call: runaway fan-out, and mostly noise (internal reads during a sync).

| | A. Audit every decrypt | B. Audit only deliberate credential *reveal*/*use* seams |
|---|---|---|
| Volume | unbounded, hot-path | bounded, meaningful |
| Signal | drowned in internal reads | the events a security reviewer actually wants |

**Lean: B.** Always audit credential **create/update** (mutations). For "access", audit only *deliberate* seams — an explicit credential reveal endpoint (if one exists) and credential *use at sync kickoff* — never the per-row `decryptRows` in every list. This keeps the deliverable's "access" coverage without a cardinality explosion.

### Decision 5 — Source IP trustworthiness (`trust proxy`)

The deliverable requires a source IP field, but with no `trust proxy` set, `req.ip` is the ALB/CloudFront hop.

**Lean: enable `app.set('trust proxy', <correct hop count>)`** for the ALB+CloudFront chain and record the resolved `req.ip` + `req.get('user-agent')` at each seam's route. Note the interaction with #574 (authenticated rate limiting is keyed per-user, so this doesn't change its keying, but any future IP logic inherits the corrected client IP). If the exact hop count is uncertain at implementation time, parse the last trusted `X-Forwarded-For` entry rather than trusting the whole chain.

### Decision 6 — Tamper-evidence depth

The deliverable says "appropriate to the store (append-only writes; no update/delete path through the app)."

| | A. App-level append-only only | B. + cryptographic hash-chain (each row hashes prev) |
|---|---|---|
| Tamper-evidence | detects app-path tampering; DB-superuser edits still possible | detects any row mutation/reordering |
| Multi-instance cost | none | hard — concurrent ECS inserts can't both chain off the same prev without a serializing lock (contention on a hot table) |

**Lean: A for this ticket.** Append-only repo (no update/delete methods), plus a DB-level guard (revoke UPDATE/DELETE on the table from the app role in the migration, or a rule/trigger that rejects them). Defer the hash-chain — its multi-instance ordering problem is real and it is an enhancement, not the SOC 2 baseline. Record it in "what this doesn't decide".

### Decision 7 — Retention window

**Lean: a separate `AUDIT_LOG_RETENTION_MONTHS`, default 24.** SOC 2 / enterprise expectation for a security trail is longer than the billing ledger's window; keep it its own env and its own scheduler entry so the two are tuned independently.

## Tradeoff comparison

| | D1: post-commit best-effort | D2: central service | D3: typed enum | D4: reveal-only access | D5: trust proxy | D6: append-only (defer chain) |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes | Yes |
| New pattern | No (mirrors ledger) | No (API style) | No | No | Yes (global app config) | Partial (DB-level grant guard) |

## Recommendation

1. Add an append-only `audit_log` table via the five-piece dual-schema pattern, modeled on `tool_usage_ledger`: columns actor (`userId`), `organizationId`, typed `action`, `targetType`, `targetId`, `outcome`, `sourceIp`, `userAgent`, `metadata` (JSON), on top of `baseColumns`. Index `(organizationId, created, id)` for the read.
2. An `AuditLogRepository` extending `Repository`, exposing only `create`, `findPage(organizationId, …)`, and `deleteOlderThan` — no update/delete surface. The migration additionally revokes UPDATE/DELETE on the table from the app DB role.
3. A central `AuditService.record(event)` that shapes the row, stamps actor/org/IP/agent, and writes **best-effort after the action commits** — a failed write logs at `error` and flags a detectable gap, never throwing into the caller (fail-open).
4. A typed `AuditAction` union + `AuditLogEntry` contract in `@portalai/core`; emit at the seams in the table above, with credential-*access* auditing limited to deliberate reveal/use seams (not per-row decrypt).
5. Enable `trust proxy` so `sourceIp` is the real client IP; capture `userAgent` alongside.
6. A read endpoint `GET /api/organization/audit-log` guarded by the **org-owner** predicate (`ownerUserId === userId`, else `403 AUDIT_LOG_NOT_AUTHORIZED`) — the predicate swaps to a `role='admin'` check when #576 lands, endpoint contract unchanged. Paginated + `sortBy` allow-map like the ledger read.
7. An `audit-log-retention-purge.processor.ts` on the `maintenance` queue, `AUDIT_LOG_RETENTION_MONTHS` (default 24), surfaced by `GET /api/admin/maintenance`. Audit rows persist beyond org soft-delete — the org-delete itself is an audited event; only the retention window ages them out.

## Open questions

1. **Is there a deliberate credential-reveal endpoint today, or only decrypt-on-read?** Decision 4 needs a concrete "access" seam. **Lean:** if none exists, audit credential *use at sync kickoff* as the access event and note reveal-auditing lands with any future reveal endpoint — don't manufacture one here.
2. **DB-level mutation guard — REVOKE grant vs trigger?** **Lean: REVOKE UPDATE, DELETE** on `audit_log` from the app role in the migration — simplest, and the app role never needs them. A trigger is a fallback if the app role is also the migration role (can't self-revoke cleanly).
3. **Login emission — does the Auth0 webhook carry the source IP of the *end user*, or of Auth0's server?** The `sourceIp` for a login row should be the user's, which the webhook may or may not include. **Lean:** record what the webhook provides (Auth0 includes `context.request.ip` in log-stream/action payloads); if absent, leave `sourceIp` null for login rows rather than recording Auth0's IP.
4. **Does `member.switch` belong in a *security* audit log?** It's frequent and low-risk. **Lean: include it** — org context switches are relevant to "who was acting as which org when" and volume is bounded by the retention purge.

## Enterprise-scale considerations

- **Concurrency & correctness.** Append-only inserts, no check-then-act; the write is post-commit best-effort, so it never races or rolls back the audited action. Multi-instance ECS is fine — independent inserts, no shared cursor (this is *why* the hash-chain is deferred).
- **Accuracy & auditability.** This *is* the record-of-truth. Tamper-evidence = no app mutate/delete path + DB-level REVOKE; append-only, one row per event.
- **Failure modes.** Fail-open + durable alert (decided): audit-write failure logs at `error` + degradation marker, never blocks the action. Graceful under DB pressure — a dropped audit row is a logged gap, not an outage.
- **Scale & unbounded growth.** The credential-decrypt hot path is the runaway risk → Decision 4 restricts access-auditing. Retention purge bounds the table; the `(org, created, id)` index keeps the read streaming (#433).
- **Multi-tenancy.** Rows are org-scoped; the read is org-scoped *and* owner-gated. No cross-org leakage — the read never takes an org id from the client, only `req.application.metadata.organizationId`.
- **Contract stability.** Typed `AuditAction` enum + the read-authz predicate that swaps to an RBAC role (#576) with no endpoint-contract change. Shaped so #576 and a future in-app activity view plug in without re-plumbing.
- **Data lifecycle.** Persist beyond org soft-delete (decided); retention in business terms (`AUDIT_LOG_RETENTION_MONTHS`, default 24, its own env + scheduler), not an arbitrary technical window.

## What this doesn't decide

- **The in-app activity view** — this ships storage + emission + read API; the view is a follow-up (per the issue's Out of scope).
- **Cryptographic hash-chaining** (Decision 6B) — deferred for its multi-instance ordering cost; a possible hardening follow-up.
- **Full RBAC roles (#576)** — the read uses an owner predicate that #576 swaps for a role check.
- **A CLI operator read path** (`portalops`/`portalai`) — the authorized API is the surface here.
- **A GDPR data-export endpoint** — this audits the *existing* export/delete seams; it does not create a new consolidated export flow.

## Next step

Write `docs/AUDIT_LOG.spec.md` (contract — the table columns + indexes, the `AuditAction` union, the `AuditService.record` signature + fail-open behavior, the read endpoint shape + owner gate, the new `ApiCode`s, the migration incl. REVOKE, the retention processor) and `docs/AUDIT_LOG.plan.md`. The plan will slice roughly as: (1) core contract + table + type-checks + migration; (2) `AuditLogRepository` + `AuditService` (fail-open) with unit tests; (3) emission wiring at the seams + `trust proxy`; (4) the owner-gated read endpoint + OpenAPI; (5) the retention purge processor + admin surface. Each slice green-testable and committed to `feat/audit-log` (base `epic/security-readiness`).

# Security audit log — Spec

Pins the contract for the append-only `audit_log`: the table + dual-schema model, the typed `AuditAction` taxonomy, the fail-open `AuditService.record` seam, the emission points, the owner-gated read endpoint, and the retention purge. Builds on `docs/AUDIT_LOG.discovery.md`. Issue [#575](https://github.com/EnterpriseBT/portal-ai/issues/575) (epic #578, branch `epic/security-readiness`, PR #595).

## Key decisions (flag for review)

1. **Post-commit, best-effort emission** — the audit write never joins the audited action's DB transaction (that would make fail-open into fail-closed). `AuditService.record` swallows its own errors, logs at `error`, and increments a degradation counter. (Discovery D1.)
2. **Central `AuditService`** owns row shaping + the fail-open wrap; seams pass a structured event. (D2.)
3. **Typed `AuditAction` union** in `@portalai/core` + structured `targetType`/`targetId`/`outcome`/`metadata`. (D3.)
4. **Credential-access auditing is limited** to deliberate reveal/sync-use seams — never the per-row `decryptRows`. (D4.)
5. **`trust proxy` enabled** so `sourceIp` is the real client IP; `userAgent` captured alongside. (D5.)
6. **Append-only tamper-evidence** via a repo with no update/delete surface **+ a DB trigger** (`audit_log_no_mutation`) that blocks every UPDATE and every DELETE *except* the retention purge, which opts in with `SET LOCAL app.audit_retention_purge = 'on'`. A `REVOKE` was the discovery lean but is a no-op against the table owner (the app connects as owner until #397), and would also block the legitimate purge — the trigger works regardless of role and gates the one allowed delete path. Hash-chain deferred. (D6, Open Q2 resolved.)
7. **Owner-gated read** (`ownerUserId === userId`, else `403 AUDIT_LOG_NOT_AUTHORIZED`) — predicate swaps to `role='admin'` when #576 lands, contract unchanged. Rows **persist beyond org soft-delete**; retention window `AUDIT_LOG_RETENTION_MONTHS` (default 24). (PRD gate + D7.)

## Scope

### In scope
- `audit_log` table (dual-schema), `AuditLogRepository`, `AuditService`, emission at the seams below, `trust proxy`, the owner-gated read endpoint, the retention purge, OpenAPI + `ApiCode`s.

### Out of scope
- The in-app activity **view** (separate ticket). Full RBAC roles (#576). A CLI operator read path. A consolidated GDPR export endpoint. Cryptographic hash-chaining.

## Surface

### 1. Core model — `packages/core/src/models/audit-log.model.ts` (new)

```ts
export const AUDIT_ACTIONS = [
  "auth.login",
  "org.create", "org.delete",
  "member.add", "member.remove", "member.switch",
  "connector.credential.create", "connector.credential.update",
  "connector.credential.access",
  "toolpack.secret.rotate",
  "data.export", "data.delete",
] as const;
export const AuditActionSchema = z.enum(AUDIT_ACTIONS);
export type AuditAction = z.infer<typeof AuditActionSchema>;

export const AuditOutcomeSchema = z.enum(["success", "failure"]);
export type AuditOutcome = z.infer<typeof AuditOutcomeSchema>;

export const AuditLogEntrySchema = CoreSchema.extend({
  organizationId: z.string(),
  userId: z.string(),                       // the actor (system id for system-initiated)
  action: AuditActionSchema,
  targetType: z.string().nullable(),        // "organization" | "connector_instance" | "toolpack" | "user" | ...
  targetId: z.string().nullable(),
  outcome: AuditOutcomeSchema,
  sourceIp: z.string().nullable(),
  userAgent: z.string().nullable(),
  metadata: z.record(z.string(), z.unknown()).nullable(),  // mirrors connector-instances `config` jsonb
});
export type AuditLogEntry = z.infer<typeof AuditLogEntrySchema>;
```

Plus `AuditLogEntryModel extends CoreModel<AuditLogEntry>` (`schema`/`parse`/`validate`) and `AuditLogEntryModelFactory extends ModelFactory<…>` with `create(createdBy)`, mirroring `tool-usage-ledger.model.ts` exactly. Export all from `packages/core/src/models/index.ts`.

### 2. Core contract — `packages/core/src/contracts/audit-log.contract.ts` (new)

```ts
export const AuditLogListRequestQuerySchema = PaginationRequestQuerySchema.extend({
  action: AuditActionSchema.optional(),
  outcome: AuditOutcomeSchema.optional(),
  sortOrder: z.enum(["asc", "desc"]).optional().default("desc"),  // newest-first
});
export type AuditLogListRequestQuery = z.infer<typeof AuditLogListRequestQuerySchema>;

export const AuditLogListResponseSchema = z.object({
  entries: z.array(AuditLogEntrySchema),
  total: z.number().int(),
});
export type AuditLogListResponse = z.infer<typeof AuditLogListResponseSchema>;
```

Export from `packages/core/src/contracts/index.ts`.

### 3. Drizzle table — `apps/api/src/db/schema/audit-log.table.ts` (new)

```ts
export const auditLog = pgTable(
  "audit_log",
  {
    ...baseColumns,
    organizationId: text("organization_id").notNull().references(() => organizations.id),
    userId: text("user_id").notNull(),
    action: text("action", { enum: AUDIT_ACTIONS }).notNull(),
    targetType: text("target_type"),
    targetId: text("target_id"),
    outcome: text("outcome", { enum: ["success", "failure"] }).notNull(),
    sourceIp: text("source_ip"),
    userAgent: text("user_agent"),
    metadata: jsonb("metadata").$type<Record<string, unknown>>(),
  },
  (t) => [
    // The read's access path (#433 scope + sort key + id tiebreaker).
    index("audit_log_org_created_idx").on(t.organizationId, t.created, t.id),
    check("audit_log_outcome_check", sql`${t.outcome} IN ('success','failure')`),
  ]
);
```

`AUDIT_ACTIONS` imported from `@portalai/core/models` (the root barrel pulls in `./ui` SVG assets that drizzle-kit's tsx loader can't parse — the `/models` subpath is clean). Register in `apps/api/src/db/schema/index.ts`. **No unique idempotency key** — duplicate audit rows are acceptable (append-only trail, not billing); a retried login webhook producing two `auth.login` rows is accurate, not a bug.

### 4. drizzle-zod — `apps/api/src/db/schema/zod.ts`

`AuditLogSelectSchema = createSelectSchema(auditLog)`, `AuditLogInsertSchema = createInsertSchema(auditLog)`, + inferred `AuditLogSelect`/`AuditLogInsert` types (mirrors the ledger block ~101-111).

### 5. Type guards — `apps/api/src/db/schema/type-checks.ts`

Bidirectional `IsAssignable<AuditLogSelect, AuditLogEntry>` + `IsAssignable<AuditLogEntry, AuditLogSelect>` + `InferSelectModel` round-trip, each `= true` (mirrors the ledger block ~193-215).

### 6. Repository — `apps/api/src/db/repositories/audit-log.repository.ts` (new)

```ts
const SORTABLE_COLUMNS = { created: auditLog.created } as const;
export type AuditLogSortBy = keyof typeof SORTABLE_COLUMNS;      // "created"
export const AUDIT_LOG_SORT_KEYS = Object.keys(SORTABLE_COLUMNS) as AuditLogSortBy[];

export class AuditLogRepository extends Repository<typeof auditLog, AuditLogSelect, AuditLogInsert> {
  constructor() { super(auditLog); }

  /** Append-only insert. No update/softDelete/hardDelete surfaced. */
  async append(row: AuditLogInsert, client: DbClient = db): Promise<void>;

  /** Org-scoped page + filter-scoped total; ORDER BY <sortBy>, id tiebreaker. */
  async findPage(
    organizationId: string,
    opts: { action?: AuditAction; outcome?: AuditOutcome; limit: number; offset: number;
            sortBy: AuditLogSortBy; sortOrder: "asc" | "desc" },
    client?: DbClient,
  ): Promise<{ entries: AuditLogSelect[]; total: number }>;

  /** Retention purge batch seam — hard-delete ≤ batchSize rows created before
   *  cutoffMs. Runs each batch in a transaction that first sets
   *  `SET LOCAL app.audit_retention_purge = 'on'` so the append-only trigger
   *  permits this — the ONLY sanctioned delete path. */
  async deleteOlderThan(cutoffMs: number, batchSize: number, client?: DbClient): Promise<number>;
}
export const auditLogRepo = new AuditLogRepository();
```

`findPage`/`deleteOlderThan` mirror the ledger repo; `findPage`'s `orderBy` appends `auditLog.id` as the tiebreaker (#433). Register `auditLog: auditLogRepo` in `apps/api/src/services/db.service.ts` (import ~39, map ~120).

### 7. Service — `apps/api/src/services/audit.service.ts` (new)

```ts
export interface AuditEvent {
  organizationId: string;
  userId: string;                       // actor
  action: AuditAction;
  outcome?: AuditOutcome;               // default "success"
  targetType?: string | null;
  targetId?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  metadata?: Record<string, unknown> | null;
}

export class AuditService {
  /**
   * Record a security event. FAIL-OPEN: never throws into the caller — a
   * failed write is logged at `error` and counted (degradation marker),
   * never propagated. Call AFTER the audited action has committed.
   */
  static async record(event: AuditEvent): Promise<void>;
}
```

`record` builds the row via `AuditLogEntryModelFactory().create(event.userId)` (actor = `createdBy`), applies the event fields, `parse()`s, and calls `auditLogRepo.append`, the whole body wrapped in `try/catch`. On catch: `logger.error({ err, action, organizationId }, "Audit write failed — trail gap")` and increment a module-level `auditWriteFailures` counter (the durable degradation marker; surfaced via the existing metrics/health path or at minimum a distinct log code). Never rethrows.

### 8. Request context helper — `apps/api/src/utils/request-context.util.ts` (edit) or new `audit-context.util.ts`

`auditContextFromRequest(req): { userId, organizationId, sourceIp, userAgent }` — reads `req.application.metadata.userId`/`organizationId`, `req.ip` (now real via `trust proxy`), `req.get("user-agent") ?? null`. Seams call this to build the common fields.

### 9. `trust proxy` — `apps/api/src/app.ts` (edit)

`app.set("trust proxy", <hop count>)` for the ALB + CloudFront chain (see Risks). Enables correct `req.ip`.

### 10. Emission wiring (edits)

| Action(s) | Seam | Notes |
|---|---|---|
| `auth.login` | `webhook.service.ts` `syncUser` (both created + existing paths) | actor = the user; `sourceIp`/`userAgent` from the webhook payload (see #12), null if absent |
| `org.create` | `application.service.ts` `setupOrganization` / `createOrganizationForEmail` | targetType `organization`, targetId = new org id |
| `org.delete` | `organization-delete.service.ts` | emitted after the tombstone commits; the org-delete is itself audited |
| `member.add` / `member.remove` | the `organizationUsers` create/soft-delete sites in the org services | targetType `user`, targetId = member user id |
| `member.switch` | `application.service.ts:94` `switchOrganization` | targetType `organization`, targetId = new current org |
| `connector.credential.create` / `.update` | `connector-instance.router.ts` create/update handlers (credential body) | targetType `connector_instance` |
| `connector.credential.access` | connector **sync kickoff** (deliberate use), + a reveal endpoint if one exists | NOT `decryptRows` per-row (D4) |
| `toolpack.secret.rotate` | `toolpacks.router.ts:762` rotate handler | targetType `toolpack` |
| `data.export` | google-sheets / microsoft-excel export handlers, `portal-sql-handle.router.ts` | targetType per source |
| `data.delete` | `connector-entity.router.ts:909`, org delete | targetType per source |

All calls are `void AuditService.record({...})` **after** the action's own success (post-commit), never awaited inside the action's transaction.

### 11. Read endpoint — `apps/api/src/routes/organization.router.ts` (edit)

`GET /api/organization/audit-log`, guarded by `getApplicationMetadata`, mirroring the ledger read (~715):
1. `AuditLogListRequestQuerySchema.safeParse(req.query)` + `AUDIT_LOG_SORT_KEYS.includes(sortBy)` → else `400 AUDIT_LOG_INVALID_QUERY`.
2. **Owner gate:** load the org (`DbService.repository.organizations.findById(orgId)`); if `organization.ownerUserId !== userId` → `403 AUDIT_LOG_NOT_AUTHORIZED` (pattern from the DELETE handler ~286). *This predicate is the single line #576 later swaps for a role check.*
3. `auditLogRepo.findPage(orgId, {...})` → `HttpService.success<AuditLogListResponse>(res, { entries, total })`.
4. Errors → `500 AUDIT_LOG_FETCH_FAILED`.

`@openapi` JSDoc block above the handler, referencing the registered component schemas.

### 12. Webhook payload extension — `packages/core/src/contracts/webhook.contract.ts` (edit)

Add optional `ip: z.string().optional()` and `user_agent: z.string().optional()` to `Auth0PostLoginWebhookPayloadSchema` so the login row can capture source IP/agent when the Auth0 post-login Action forwards `event.request.ip` / `event.request.user_agent`. Absent → null (Open Q3 lean). Updating the Auth0 Action to send them is an infra config step noted in the smoke doc.

### 13. `ApiCode`s — `apps/api/src/constants/api-codes.constants.ts` (edit)

Add (near the ledger codes ~650): `AUDIT_LOG_INVALID_QUERY`, `AUDIT_LOG_FETCH_FAILED`, `AUDIT_LOG_NOT_AUTHORIZED`. Optional default text in `ApiCodeDefaultRecommendation`.

### 14. OpenAPI — `apps/api/src/config/swagger.config.ts` (edit)

Register `AuditLogEntry` + `AuditLogListResponse` via `z.toJSONSchema(...)` (mirrors `usageLedgerSchemas` ~368-377), sourced from `@portalai/core`.

### 15. Retention — processor + queue + worker + env (edits/new)

- New `apps/api/src/queues/processors/audit-log-retention-purge.processor.ts` — mirrors `ledger-retention-purge.processor.ts`: `AUDIT_LOG_PURGE_BATCH_SIZE = 10_000`, `AuditLogRetentionPurgeSummary { purged, batches, cutoff }`, window `environment.AUDIT_LOG_RETENTION_MONTHS`, drain loop over `auditLogRepo.deleteOlderThan` (which sets the `app.audit_retention_purge` flag per §6 so the append-only trigger permits its DELETEs).
- `apps/api/src/queues/maintenance.queue.ts` — add `AUDIT_LOG_RETENTION_PURGE_JOB = "audit-log-retention-purge"` const + a scheduler entry (`{ pattern: "30 5 * * *" }` — after the message-dissolve purge, no worker-slot contention).
- `apps/api/src/queues/maintenance.worker.ts` — dispatch `if (job.name === AUDIT_LOG_RETENTION_PURGE_JOB)`.
- `apps/api/src/environment.ts` — `AUDIT_LOG_RETENTION_MONTHS` (default 24). `GET /api/admin/maintenance` surfaces the run automatically (generic scheduler read).

## Migration

`0094_add-audit-log-table.sql` (`npm run db:generate -- --name add-audit-log-table`), hand-edited to append the tamper-evidence guard as a **trigger** (Open Q2 resolved — the app connects as the table owner, so `REVOKE` is a no-op, and a blanket block would break the retention purge):

```sql
CREATE OR REPLACE FUNCTION audit_log_prevent_mutation() RETURNS trigger AS $$
BEGIN
  IF TG_OP = 'DELETE'
    AND current_setting('app.audit_retention_purge', true) = 'on' THEN
    RETURN OLD;                       -- the retention purge (§15) opts in
  END IF;
  RAISE EXCEPTION 'audit_log is append-only: % is not permitted', TG_OP
    USING ERRCODE = 'insufficient_privilege';
END;
$$ LANGUAGE plpgsql;
CREATE TRIGGER audit_log_no_mutation
  BEFORE UPDATE OR DELETE ON "audit_log"
  FOR EACH ROW EXECUTE FUNCTION audit_log_prevent_mutation();
```

UPDATE is never permitted; DELETE only under the purge's `SET LOCAL app.audit_retention_purge = 'on'`. Validated against Postgres 17 (UPDATE blocked, unflagged DELETE blocked, flagged DELETE allowed). No backfill — new table. No seed.

## Seed

None — `audit_log` is populated only by live emission.

## TDD test plan

### `packages/core` — `npm run test:unit`
- `packages/core/src/models/__tests__/audit-log.model.test.ts` — schema accepts a valid entry; rejects an unknown `action`; rejects a bad `outcome`; nullable `targetType`/`targetId`/`sourceIp`/`userAgent`/`metadata`; factory `create(createdBy)` stamps base fields. (~7 cases)
- `packages/core/src/contracts/__tests__/audit-log.contract.test.ts` — query defaults `sortOrder='desc'`; optional `action`/`outcome` filters parse; response shape. (~4)

### `apps/api` — `npm run test:unit`
- `apps/api/src/services/__tests__/audit.service.test.ts` — `record` writes a row with actor/action/target/outcome/ip/ua; **fail-open**: when `auditLogRepo.append` throws, `record` resolves (does not throw) and logs at `error` + bumps the failure counter; defaults `outcome='success'`. (~6)
- `apps/api/src/db/repositories/__tests__/audit-log.repository.test.ts` — `append` inserts; `findPage` org-scopes + filters by action/outcome + orders newest-first with id tiebreaker + returns total; `deleteOlderThan` batch-deletes by cutoff. (~7)
- Type-checks compile-guard: covered by `type-check` (no runtime test needed).

### `apps/api` — `npm run test:integration`
- `apps/api/src/__tests__/__integration__/routes/audit-log.router.integration.test.ts` — owner gets a page; **non-owner member → 403 `AUDIT_LOG_NOT_AUTHORIZED`**; invalid `sortBy` → 400; org-scoping (org A cannot see org B's rows); pagination/total. (~6)
- `apps/api/src/__tests__/__integration__/services/audit-emission.integration.test.ts` — a representative seam (e.g. `org.delete` or `toolpack.secret.rotate`) produces an `audit_log` row with the right actor/target/outcome; and the audited action still succeeds when the audit write is forced to fail (fail-open, end-to-end). (~3)
- `apps/api/src/__tests__/__integration__/queues/audit-log-retention-purge.integration.test.ts` — rows older than the window are purged, newer retained, summary shape correct. (~3)
- Tamper-evidence: an integration assertion that the app cannot `UPDATE` or (unflagged) `DELETE` an `audit_log` row — the trigger raises — while a `SET LOCAL app.audit_retention_purge='on'` DELETE succeeds. (~1)

**Totals ≈ 37 cases.**

## Acceptance criteria

- Security-relevant actions (the seams in §10) produce `audit_log` rows with actor + target + outcome.
- The app exposes no update/delete path for audit rows (no repo methods; the DB trigger blocks it).
- The **org owner** can retrieve their org's trail via `GET /api/organization/audit-log`; a non-owner member gets `403 AUDIT_LOG_NOT_AUTHORIZED`.
- Audit rows survive their org's soft-delete; `org.delete` itself appears in the trail.
- A failed audit write does not fail the underlying action; the failure is logged at `error` + counted, not swallowed silently.
- Rows older than `AUDIT_LOG_RETENTION_MONTHS` are purged by the daily maintenance job; the run shows in `GET /api/admin/maintenance`.

## Risks & rollback

- **Fail-mode:** fail-open by design — an audit-store outage means *missing* rows (a logged, counted gap), never a blocked login/action. The safety cost (a gap in the trail) is accepted over the availability cost of fail-closed; the counter makes the gap detectable.
- **`trust proxy` hop count** (D5): wrong count → wrong `sourceIp`, or (if over-trusting) a client-spoofable IP. Pin the count to the actual ALB+CloudFront chain; if uncertain, trust exactly the known hops and read the corresponding `X-Forwarded-For` entry. Touches the same request-IP surface as #574 (rate limiting) — verify #574's keying is unaffected (it keys per-user, so it is).
- **Tamper-evidence mechanism** (Open Q2 resolved): a trigger, not a REVOKE — the app owns the table, so REVOKE is a no-op, and the trigger additionally permits the purge's flagged DELETE. A table owner/superuser can still drop the trigger; that DBA-level threat is out of scope (the guarantee is that no *application* path mutates). The purge flag is `SET LOCAL` (transaction-scoped), so it can't leak to an ordinary request.
- **Rollback:** the table + emission are additive; disabling is dropping the scheduler + no-op-ing `AuditService.record`. The trigger is reversible with `DROP TRIGGER`/`DROP FUNCTION`.

## Files touched

- **New:** `packages/core/src/models/audit-log.model.ts`, `packages/core/src/contracts/audit-log.contract.ts`, `apps/api/src/db/schema/audit-log.table.ts`, `apps/api/src/db/repositories/audit-log.repository.ts`, `apps/api/src/services/audit.service.ts`, `apps/api/src/queues/processors/audit-log-retention-purge.processor.ts`, `apps/api/drizzle/0094_add-audit-log-table.sql`, the four test files above.
- **Edit:** `packages/core/src/models/index.ts`, `packages/core/src/contracts/index.ts`, `packages/core/src/contracts/webhook.contract.ts`, `apps/api/src/db/schema/{index,zod,type-checks}.ts`, `apps/api/src/services/db.service.ts`, `apps/api/src/app.ts`, `apps/api/src/routes/organization.router.ts`, `apps/api/src/constants/api-codes.constants.ts`, `apps/api/src/config/swagger.config.ts`, `apps/api/src/environment.ts`, `apps/api/src/queues/maintenance.{queue,worker}.ts`, and the emission seams in §10 (`webhook.service.ts`, `application.service.ts`, `organization-delete.service.ts`, `connector-instance.router.ts`, `toolpacks.router.ts`, `connector-entity.router.ts`, connector export handlers).

## Next step

`docs/AUDIT_LOG.plan.md` — roughly five TDD slices, each a commit on `feat/audit-log`: (1) core model + contract + table + zod + type-checks + migration (incl. the append-only trigger); (2) `AuditLogRepository` + `AuditService` (fail-open) with unit tests; (3) `trust proxy` + audit-context helper + emission wiring at the seams + emission integration test; (4) owner-gated read endpoint + `ApiCode`s + OpenAPI + integration test; (5) retention processor + queue/worker/env + purge integration test. Each slice leaves the tree green.

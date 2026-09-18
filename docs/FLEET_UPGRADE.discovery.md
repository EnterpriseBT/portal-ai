# Self-contained fleet upgrade — Discovery

**Issue:** [EnterpriseBT/portal-ai#581](https://github.com/EnterpriseBT/portal-ai/issues/581)

**Why this exists.** A residency deployment is _N_ self-contained installs the customer runs on their own infrastructure (the L2 Helm chart, #566). Because control and data ship as one unit, there is **no** cross-plane version contract to maintain — the residual ongoing cost is making a per-install *upgrade* safe on the customer's maintenance window: pending schema migrations and per-org data backfills must both run automatically when the customer deploys a new chart version, idempotently, with a signal an operator who can't read a stack trace can act on. The chart already runs schema migrations on upgrade; it does **not** re-run seeds or reliably carry per-org backfills, and there is no unified success/failure signal. This is the ticket that closes that upgrade-time gap and makes the marketplace update channel a safe, re-runnable operation.

## The current shape

### Migration runner — the resolver-aware `db-migrate` path (#505/#500)

| Piece | Location | Note |
|---|---|---|
| Deploy/CI migrate entrypoint | `apps/api/src/scripts/db-migrate.ts` | The #505 work. `db:migrate:ci` → `node dist/scripts/db-migrate.js`. Calls drizzle-orm `migrate(drizzle(sql), { migrationsFolder })`, **not** drizzle-kit. |
| Per-connection password resolver | `apps/api/src/db/credentials.util.ts` | `createDbPasswordResolver({ masterSecretArn, fallbackPassword, ttlMs })` → `resolve()`/`invalidate()`. Fail-open, TTL-cached, single-flight; constant fallback when no `DB_MASTER_SECRET_ARN` (local/dev). Same resolver backs the app pool at `apps/api/src/db/client.ts`. |
| Migration ledger | `apps/api/drizzle/meta/_journal.json` | v7, postgres, 96 entries (0000–0095, latest `0095_add_org_marketplace_entitlement_columns.sql`). drizzle also tracks applied files in `__drizzle_migrations`. |

Migrations **already run on upgrade** — this is the spine #581 builds on, not new work.

### Per-org / per-install backfills — the #316/#414 pattern

| Piece | Location | Note |
|---|---|---|
| Backfill migration template | `apps/api/drizzle/0080_backfill-geospatial-column-definitions.sql` | `INSERT … SELECT FROM organizations o CROSS JOIN (VALUES …) WHERE o.deleted IS NULL ON CONFLICT (organization_id, key) WHERE deleted IS NULL DO NOTHING`. The `ON CONFLICT` **restates the partial-index predicate** → verified no-op on orgs that already hold the keys. |
| Per-org seed source of truth | `apps/api/src/services/seed.service.ts:51` (`SYSTEM_COLUMN_DEFINITIONS`) | Applied per-org by `seedSystemColumnDefinitions(orgId, db)` (`seed.service.ts:571`), upsert-by-key. |
| The load-bearing gap | `seed.service.ts:38` doc + `0080` header | `seedSystemColumnDefinitions` runs **only** at org provisioning (`application.service.ts:344`) + reset. Adding a `SYSTEM_COLUMN_DEFINITIONS` entry **requires** a paired backfill migration — else existing orgs are stranded (exactly what #414 repaired after #316). |
| Global (not per-org) seed | `SeedService.seed()` (`seed.service.ts:352`) → `apps/api/src/db/seed.ts` | Transactional `seedTiers` + `seedConnectorDefinitions`, insert-if-absent. `db:seed` / `db:seed:ci`. |

### The Helm chart hooks (#566)

| Hook | Location | Behavior |
|---|---|---|
| Migrate | `deploy/helm/portalai/templates/migrate-job.yaml` | `helm.sh/hook: pre-install,pre-upgrade`, weight `-5`, `backoffLimit: 6`, runs `node dist/scripts/db-migrate.js`. **Runs on every upgrade** before api pods roll. |
| Seed | `deploy/helm/portalai/templates/seed-job.yaml` | `helm.sh/hook: post-install` **only** (weight `5`), runs `node dist/db/seed.js`. **Does not run on upgrade.** |

Toggles in `values.yaml`: `migrate.enabled` / `seed.enabled`; bundled `postgresql` (PostGIS), `redis`, `minio` each with an `external:` block; `deployMode`, `oidc.*`, `bundledIssuer.enabled`.

**The gap in one line:** schema migrations run on upgrade; global seeds and any per-org catalog additions that ride a seed (not a migration) do **not**; and there is no single operator-readable signal for the whole operation.

### Deploy-mode seam (#579) and orchestration precedents

- `apps/api/src/config/deploy-mode.ts` — `isResidency()`/`isSaas()`, `assertDeployModeConsistency()` (fail-closed boot guard), called first in `start()` at `apps/api/src/index.ts:48`.
- Boot-time orchestration to model on (`apps/api/src/index.ts` `start()`): `wideTableReconcilerService.reconcileAll()` (**fail-closed drift check**, `index.ts:66`), `registerMaintenanceSchedulers()` (fire-and-forget), `JobReconciliationService.sweepStrandedJobs()` (**fail-open, idempotent, multi-instance-safe**).
- Ops surfaces: `packages/devops-cli/src/commands/db.ts` exposes `dbSeed`/`dbResetSeed` but **no `db migrate`** subcommand today (migrate is an ECS one-off / Helm hook). `GET /api/admin/maintenance` (`apps/api/src/routes/admin.router.ts:213`) is the only ops read of housekeeping status; no migration/backfill status surface exists. `apps/api/Dockerfile` CMD (`dist/index.js`) does **not** run migrate on boot.

## The design space

### Decision 1 — Upgrade orchestration shape

**A. Add `post-upgrade` to the seed hook.** Minimal: seed-job gains `post-upgrade`, migrate stays `pre-upgrade`. Two Jobs, two exit signals, per-org backfills stay in the migrate SQL.

**B. A unified `db:upgrade` entrypoint.** One script (`db-upgrade.ts`) = migrate → global seed → per-org catalog convergence, run as a single `pre-upgrade` hook Job with one structured summary + exit code. Keep the `post-install` seed for the first-install bundled-DB caveat (DB isn't up at `pre-install`).

**C. Boot-time upgrade in the API entrypoint.** Rejected — N replicas race the same migrate, and there's no gate before pods serve the new schema.

| | A (post-upgrade seed) | B (unified `db:upgrade`) | C (boot-time) |
|---|---|---|---|
| Operator signal | Two Jobs to read | One final line + exit | Buried in pod logs, per replica |
| Concurrency | Two single Jobs | One single Job | N-replica race |
| First-install caveat | Handled (post-install stays) | Handled (post-install stays) | Unhandled |

**Lean: B.** One command, one Job, one signal — "UPGRADE COMPLETE / FAILED: <reason>" is what an operator who can't read a stack trace acts on. On upgrade the DB + schema already exist, so running seed in the same pre-upgrade process right after migrate is safe.

### Decision 2 — How per-org backfills run per-install

**A. Keep backfills as ordered idempotent SQL migrations** (the `0080` pattern) — they already run via migrate on upgrade. "Promotion to per-install" = they now run automatically wherever the chart upgrades, **plus a guard** that a new per-org seed entry ships a paired backfill.

**B. A runtime `BackfillRegistry`** of idempotent functions `db:upgrade` runs against all orgs (like `seedSystemColumnDefinitions`, looped over every org).

| | A (SQL migrations + guard) | B (runtime registry) |
|---|---|---|
| Ordering / record-of-truth | drizzle journal + `__drizzle_migrations` | Bespoke tracking to build |
| Already runs on upgrade | Yes | No — new machinery |
| Stranding prevention | Guard test (mechanical) | Registry coverage (must be complete) |

**Lean: A.** SQL migrations are the ordered, transactional, already-running record-of-truth. The "skipped backfill strands the install" requirement is met by turning the `CLAUDE.md` #414 prose lesson into a **guard test**: a new `SYSTEM_COLUMN_DEFINITIONS` (or any per-org seeded row) entry must ship a paired backfill migration or CI fails.

### Decision 3 — Failure signal & rollback semantics

drizzle migrations are **forward-only** (no down-migrations exist, and none should). So "rollback" cannot mean reverting schema — a mistake is undone by a *new forward migration*. The posture:

- **Expand-only migration discipline** — every migration is backward-compatible with the *previous* image, so if a later hook step fails, the old pods keep running against the expanded schema. `helm upgrade --atomic` then rolls the *workloads* back while the schema stays valid.
- **Per-file transactionality** — drizzle wraps each migration file in a transaction, so a failure never leaves a half-applied file.
- **A destructive-migration check that surfaces the risk at review** — a `lint:migrations` guard (same family as `lint:ci-cache` / `lint:doc-pointers`) scans new/changed `apps/api/drizzle/*.sql` for destructive DDL (`DROP TABLE`, `DROP COLUMN`, `ALTER … DROP`, `TRUNCATE`, `DROP … CONSTRAINT`, type-narrowing `ALTER … TYPE`). A match **fails CI unless the statement carries an inline `-- destructive-ok: <reason>` acknowledgment** — so an intentional destructive change (post-deprecation-window cleanup) is a deliberate, reviewed, in-file act, and an accidental one can't land silently. This mirrors the zero-warning "an `eslint-disable` carries its reason in-file" convention.

**Lean: all three.** Expand-only is enforced by the destructive-migration check + review (not a hard block on intent — an acknowledged destructive migration is allowed); `db:upgrade` emits a one-line final status + non-zero exit on any failure; `NOTES.txt` tells the operator to read the Job log and recommends `--atomic`. No DB down-migrations, ever — forward-only is the contract.

### Decision 4 — Operator status surface

**A. Logs + exit code + `NOTES.txt`.** `db:upgrade` prints a structured summary (`migrations applied: N`, `seeds: ok`, `backfills: ok`); the Job exit code is the gate; `NOTES.txt` names the `kubectl logs job/…` to read.

**B. An in-app migration-status panel** (extend `GET /api/admin/maintenance` or a schema-version readout).

**Lean: A for this ticket.** The exit code is the machine signal, the final summary line is the human one. An in-app panel is a nice follow-up but not what makes an upgrade safe. Defer B.

### Decision 5 — Does SaaS share the mechanism?

The epic through-line is "SaaS is just another deployment." SaaS today migrates via an out-of-band ECS one-off; there is no `portalops db migrate`. A `portalops db upgrade` subcommand running the **same** `db:upgrade` entrypoint makes SaaS and residency share one upgrade command across two delivery channels (Helm hook / ECS one-off).

**Decided: add `portalops db upgrade`, and keep it deployment-agnostic.** It is a thin wrapper over the same script with **no `saas`/`residency` branching** — it routes only by *env shape* exactly as the existing `dbSeed` does (`packages/devops-cli/src/commands/db.ts`: deployed envs → an ECS one-off inside the container; local → spawn the app's own script). The residency install never uses the CLI at all (it upgrades via Helm); the CLI exists for *our* SaaS/ECS channel and stays ignorant of deploy mode. One entrypoint, two channels, no fork.

## Tradeoff comparison

|  | Unified `db:upgrade` (D1-B) | SQL backfills + guard (D2-A) | Expand-only + `--atomic` (D3) | `portalops db upgrade` (D5) |
|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes |
| New runtime state | No | No | No | No |
| Enforced by a test | Summary/exit unit test | Guard test (#414) | Expand-only is discipline + review | Command smoke |

## Recommendation

1. Add a single `apps/api/src/scripts/db-upgrade.ts` entrypoint (`db:upgrade` / `db:upgrade:ci`) that runs, in order and under one process: the resolver-aware migrate, the global idempotent seed, and per-org catalog convergence — emitting a structured final summary and a non-zero exit on any failure.
2. Guard `db:upgrade` with a **session-scoped Postgres advisory lock** so two overlapping upgrades (the ECS/manual path) can't race the migrator; the Helm single-Job already guarantees one runner, but the lock makes the command safe everywhere.
3. Keep per-org backfills as ordered idempotent SQL data-migrations (the `0080` pattern); they already run via migrate on upgrade.
4. Add a **guard test** codifying the #414 lesson: a new `SYSTEM_COLUMN_DEFINITIONS` entry (and, generally, any per-org seeded row) must ship a paired backfill migration, or CI fails.
5. Wire the chart to run `db:upgrade` on `pre-upgrade` as one unified hook Job; keep the `post-install` seed for the first-install bundled-DB caveat; add a `NOTES.txt` post-upgrade message pointing at the Job log and recommending `helm upgrade --atomic`.
6. Add a `lint:migrations` guard that fails CI on destructive DDL in new/changed `apps/api/drizzle/*.sql` unless the statement carries `-- destructive-ok: <reason>`; document the expand-only, forward-only posture ("failed upgrade = old pods keep running on the expanded schema, `--atomic` rolls workloads back; a mistake is undone by a new forward migration").
7. Add `portalops db upgrade --env` running the same entrypoint via env-shape routing (ECS one-off in deployed envs, local spawn otherwise) — **no deploy-mode branching in the CLI**; it serves our SaaS/ECS channel, residency upgrades via Helm.
8. Update the durable docs (`docs/PROD_DEPLOY.runbook.md`, the chart README, `CLAUDE.md`'s migration/backfill sections) to describe the one upgrade path.

## Open questions

1. **Unified `db:upgrade` vs adding `post-upgrade` to the existing seed job?** A unified command gives one signal but couples migrate+seed timing; the split keeps them independent. **Lean: unified `db:upgrade` for the upgrade path, keep the `post-install` seed job for first install.**
2. **Advisory lock — session-scoped Postgres advisory lock, or rely on Helm's single Job?** **Lean: add the advisory lock** (`SyncLockService`-style `withLock`) so the command is safe on the ECS/manual channel too, not just under Helm.
3. **Guard scope — only `SYSTEM_COLUMN_DEFINITIONS`, or any per-org seeded array?** **Lean: generalize to any per-org seeded row**, starting with `SYSTEM_COLUMN_DEFINITIONS`; the mechanism is "per-org seed entry ⇒ paired backfill migration exists."
4. **Does `db:upgrade` also run `portalops tier apply` (record-of-truth tier convergence, #218), or only bootstrap seeds?** **Decided: no.** `db:upgrade` runs bootstrap-idempotent seeds only; tier policy convergence stays a separate, **explicit operator action** (`portalops tier apply`). An upgrade does not silently re-shape a customer's tier policy.
5. **Status surface depth — logs + exit + NOTES only, or extend `GET /api/admin/maintenance`?** **Lean: logs + exit + NOTES for this ticket; defer the in-app panel.**

## Enterprise-scale considerations

- **Concurrency & correctness.** Two simultaneous migrators corrupt the journal. The Helm hook is a single Job (one runner guaranteed); the ECS/manual path is not. **Lean: session-scoped Postgres advisory lock around `db:upgrade`** — the same reasoning as `SyncLockService.withInstanceLock` (#460): don't trust a timer, take the lock.
- **Accuracy & auditability.** `__drizzle_migrations` is the durable record of applied schema; seeds/backfills are idempotent (`ON CONFLICT`/upsert-by-key). **Lean: rely on `__drizzle_migrations` as record-of-truth; `db:upgrade` logs a summary; no new ledger.**
- **Failure modes.** Upgrade is **fail-closed** — a failed migrate blocks the rollout (pre-upgrade hook non-zero), so pods never serve a schema that didn't apply. The password resolver stays fail-open (last-known-good). Expand-only keeps the previous image valid under a failed later step, and the `lint:migrations` destructive-DDL check keeps an accidental drop from ever reaching a customer's data. **Lean: fail-closed upgrade + expand-only schema + destructive-migration guard.**
- **Scale & unbounded growth.** Per-org backfills cross-join `organizations`; residency org counts are small (often 1), SaaS larger but backfills are one-time ordered migrations. **Lean: fine; for a very large per-org backfill, batch server-side (chunked `VALUES`, per the drizzle array-binding gotcha) — no marshalling id lists through Node.**
- **Multi-tenancy.** Backfills iterate all orgs by construction (the cross-join); no per-tenant path needed. **N/A because the pattern is already all-orgs.**
- **Contract stability.** The `db:upgrade` command + expand-only discipline + guard test are the stable seam: a future backfill plugs in as one more SQL migration, no call-site re-plumbing. **Lean: the single command + the guard are the contract.**
- **Data lifecycle.** Migrations are forward-only; retention/windows are owned by the maintenance purges (#442), out of scope here. **N/A because this ticket adds no time-windowed data.**

## What this doesn't decide

- **DB down-migrations.** Forward-only stays the contract; rollback means redeploy the old (forward-compatible) image, not revert schema.
- **An in-app migration/backfill dashboard.** Deferred (Decision 4-B) — logs + exit + NOTES are enough to make an upgrade safe; a panel is a separate ops-visibility ticket.
- **The marketplace update-channel packaging itself.** Owned by #566 (chart) and #568 (marketplace listing); this ticket rides that channel, it doesn't build it.
- **Per-org backfill parallelization / very-large-tenant tuning.** Out of scope until metrics show pressure.
- **Tier policy convergence at upgrade.** Stays the explicit `portalops tier apply` (#218), not folded into `db:upgrade` (Open question 4).

## Next step

Write `docs/FLEET_UPGRADE.spec.md` (the contract: the `db:upgrade` command surface, its summary/exit-code shape, the advisory-lock semantics, the two guard checks' assertions, and the chart hook + `NOTES.txt` changes) and `docs/FLEET_UPGRADE.plan.md` (TDD slices). The plan slices roughly as: (1) `db:upgrade` entrypoint wrapping migrate+seed with structured summary + exit code + advisory lock; (2) the #414 per-org-backfill guard test; (3) the `lint:migrations` destructive-DDL check; (4) chart wiring (unified pre-upgrade hook + `NOTES.txt`); (5) `portalops db upgrade` subcommand (env-shape routing, no deploy-mode branching); (6) durable-doc updates. Each slice is an independently green-testable commit on `feat/581-fleet-upgrade`, PR'd back into `epic/enterprise-deployment`.

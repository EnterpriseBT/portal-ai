# Self-contained fleet upgrade — Spec

**Issue:** [EnterpriseBT/portal-ai#581](https://github.com/EnterpriseBT/portal-ai/issues/581) · **Epic:** #569 · **Discovery:** `docs/FLEET_UPGRADE.discovery.md`

This spec pins the contract for making a per-install upgrade safe: a single `db:upgrade` entrypoint (resolver-aware migrate → idempotent global seed) guarded by a **session-scoped Postgres advisory lock**, a structured final signal + exit code, a `pre-upgrade` chart hook that runs it, two CI guards (a **destructive-DDL check** and a **per-org-backfill coverage** guard) that make the #414 stranding a build failure, and a deployment-agnostic `portalops db upgrade` wrapper for our own SaaS/ECS channel. No new runtime state, no schema change.

## Key decisions (flag for review)

1. **Unified `db:upgrade`** (migrate + seed in one process, one signal), run as a `pre-upgrade` chart hook — discovery D1-B. First-install keeps the existing `pre-install` migrate + `post-install` seed jobs (bundled-DB timing caveat).
2. **Reuse the existing session-scoped advisory lock.** `db:upgrade` takes `SyncLockService.withAdvisoryLock(UPGRADE_LOCK_NAMESPACE, "db-upgrade", fn)` — the generalized, non-blocking, fail-closed, session-scoped lock already shipped for #460/#472 (`apps/api/src/services/sync-lock.service.ts`, returning `{ acquired: true; value } | { acquired: false }`). We add only a new namespace constant; can't acquire ⇒ "another upgrade in progress" ⇒ exit non-zero, no work. **No new lock primitive** — reinventing `withEntityLock`'s sibling would duplicate live code.
3. **Per-org backfills stay ordered idempotent SQL migrations** (the `0080` pattern); they run inside `db:upgrade`'s migrate step. A **coverage guard** makes a new `SYSTEM_COLUMN_DEFINITIONS` key without a paired backfill migration fail CI.
4. **Destructive-DDL is surfaced at review, not silently blocked** — `lint:migrations` fails on destructive DDL unless the statement carries `-- destructive-ok: <reason>`.
5. **`portalops db upgrade` routes by env shape only** (ECS one-off in deployed envs / local spawn), no `saas`/`residency` branching; residency upgrades via Helm and never touches the CLI. Discovery D5.
6. **Tiers are NOT converged by `db:upgrade`** — `portalops tier apply` stays the explicit operator action (#218 / discovery OQ4).
7. **Forward-only, expand-only** stays the migration contract; a mistake is undone by a new forward migration.

## Scope

### In scope

1. `apps/api/src/scripts/db-upgrade.ts` (new) — `runUpgrade()` = advisory-locked (migrate → seed) with a structured summary + exit code; `db:upgrade` / `db:upgrade:ci` scripts.
2. `apps/api/src/services/sync-lock.service.ts` — add `UPGRADE_LOCK_NAMESPACE` (an ASCII-int constant like the existing `SYNC_LOCK_NAMESPACE`/`DISSOLVE_LOCK_NAMESPACE`); `db:upgrade` calls the existing `SyncLockService.withAdvisoryLock`. No new lock primitive.
3. `scripts/check-migrations.mjs` + `npm run lint:migrations` (new) — destructive-DDL scan with `-- destructive-ok:` acknowledgment + embedded self-test fixtures (the `check-ci-cache.mjs`/`check-helm.mjs` family); wired into CI.
4. `apps/api` backfill-coverage guard test — every `SYSTEM_COLUMN_DEFINITIONS` key is baseline-or-has-a-backfill-marker.
5. Backfill-marker convention `-- backfill:system-column:<key>` added to the existing `0080` backfill (retroactive) so the geospatial keys satisfy the guard.
6. Chart: new `deploy/helm/portalai/templates/upgrade-job.yaml` (`pre-upgrade` hook → `db:upgrade:ci`), unchanged install-path `migrate-job.yaml`/`seed-job.yaml`, `values.yaml` `upgrade.enabled`, and `NOTES.txt` post-upgrade guidance.
7. `packages/devops-cli` — `dbUpgrade` command + `db upgrade` subcommand wiring, env-shape routing mirroring `dbSeed`.
8. Durable-doc updates: `deploy/helm/portalai/README.md` (or chart NOTES), `docs/PROD_DEPLOY.runbook.md`, `CLAUDE.md`'s migration/backfill sections, `packages/devops-cli/COMMANDS.md`.

### Out of scope

- **DB down-migrations / schema rollback** — forward-only forever (discovery "What this doesn't decide").
- **An in-app migration/backfill status panel** — logs + exit + NOTES only (discovery D4-A); `GET /api/admin/maintenance` untouched.
- **Tier policy convergence at upgrade** — stays `portalops tier apply` (#218).
- **The marketplace update-channel packaging** — owned by #566/#568.
- **Per-org backfill parallelization / large-tenant tuning** — until metrics show pressure.

## Surface

### `db:upgrade` entrypoint

**File: `apps/api/src/scripts/db-upgrade.ts`** (new) — mirrors `db-migrate.ts`'s entrypoint guard (`import.meta.url === pathToFileURL(process.argv[1]).href`, exit 0/1).

```ts
export interface UpgradeSummary {
  acquiredLock: boolean;        // false ⇒ another upgrade held the lock; nothing ran
  migrationsApplied: number;    // __drizzle_migrations row-count delta across the migrate step
  seedOk: boolean;              // global bootstrap seed completed
  durationMs: number;
}

/** Advisory-locked migrate → seed. Reuses the #500 resolver (createDbPasswordResolver)
 *  exactly as db-migrate.ts does. Emits a structured summary + a final human line;
 *  the caller (entrypoint) maps it to an exit code. */
export async function runUpgrade(): Promise<UpgradeSummary>;
```

Behavior, in order:
1. Acquire `SyncLockService.withAdvisoryLock(UPGRADE_LOCK_NAMESPACE, "db-upgrade", fn)`. **`{ acquired: false }` ⇒** log `UPGRADE SKIPPED: another upgrade is already running`, return `{ acquiredLock: false, … }`, entrypoint **exits non-zero** (fail-closed — never two concurrent migrators). Steps 2–4 run inside `fn`.
2. Run migrations via the existing `runMigrations()` path (schema + the `0080`-style per-org SQL backfills ride here). Capture `migrationsApplied` from a `SELECT count(*) FROM drizzle.__drizzle_migrations` delta.
3. Run global bootstrap seed (`new SeedService().seed()` — idempotent `seedTiers` + `seedConnectorDefinitions`).
4. Release the lock (finally), emit the summary, and a final line: **`UPGRADE COMPLETE (migrations: N, seed: ok)`** on success or **`UPGRADE FAILED: <one-line reason>`** on any throw.

Exit code: `0` only on `acquiredLock && seedOk && migrate-succeeded`; `1` otherwise. Any thrown error is caught at the entrypoint, logged one-line, exit `1` (schema is left in whatever forward state migrate reached — expand-only keeps the previous image valid; `helm upgrade --atomic` rolls the workloads back).

**`apps/api/package.json` scripts:**
```jsonc
"db:upgrade": "dotenv -e .env -- tsx src/scripts/db-upgrade.ts",
"db:upgrade:ci": "node dist/scripts/db-upgrade.js",
```

### Upgrade advisory-lock namespace (reuse)

**File: `apps/api/src/services/sync-lock.service.ts`** — add one constant beside `SYNC_LOCK_NAMESPACE` (`0x5359_4e43` "SYNC") and `DISSOLVE_LOCK_NAMESPACE` (`0x4453_4c56` "DSLV"):

```ts
/** Advisory-lock namespace for the whole-DB upgrade (#581), keyed by the
 *  constant "db-upgrade" (a singleton). Distinct from the sync/dissolve
 *  namespaces so it never collides in Postgres's single advisory keyspace.
 *  0x5550_4752 is ASCII "UPGR". */
export const UPGRADE_LOCK_NAMESPACE = 0x5550_4752;
```

`db:upgrade` then calls the **existing** `SyncLockService.withAdvisoryLock(UPGRADE_LOCK_NAMESPACE, "db-upgrade", fn)` — already session-scoped (`reserveConnection` + `pg_try_advisory_lock` + `pg_advisory_unlock` in a `finally`), non-blocking, and fail-closed (`{ acquired: false }` without running `fn`). Session-scoped is exactly right here: `migrate()` opens its own transactions, so an xact lock would release between files — `withAdvisoryLock` holds the lock on its own reserved connection for the whole block. No new primitive; the lock's behavior is already covered by the `sync-lock` integration tests.

### `lint:migrations` — destructive-DDL guard

**File: `scripts/check-migrations.mjs`** (new) + **root `package.json`**: `"lint:migrations": "node scripts/check-migrations.mjs"`. Same shape as `scripts/check-ci-cache.mjs` (module doc explaining the silent failure it prevents; `--self-test` runs embedded fixtures before the real tree).

- Scans `apps/api/drizzle/*.sql` **changed in the PR** (falls back to all files on `--self-test`/full run) for destructive DDL: `DROP TABLE`, `DROP COLUMN`, `ALTER … DROP`, `DROP … CONSTRAINT`, `TRUNCATE`, `ALTER COLUMN … TYPE` (narrowing) — case-insensitive, comment-stripped.
- A matched line **passes only if** the statement (or the line above) carries `-- destructive-ok: <reason>` with a non-empty reason. Otherwise the script **exits non-zero**, naming the file + statement + the marker to add.
- Self-test fixtures: a destructive statement without a marker fails; the same with a valid marker passes; a non-destructive migration passes; an empty-reason marker fails.
- Wired into `unit-test.yml` next to `lint:ci-cache` / `lint:helm` (a required-check job).

### Per-org backfill coverage guard

**File: `apps/api/src/services/__tests__/seed-backfill-coverage.test.ts`** (new) — needs the TS catalog, so it's a jest unit test, not the `.mjs` script.

- `BASELINE_SYSTEM_COLUMN_KEYS` — a literal snapshot of the keys that predate this guard (they reached existing orgs at provisioning-time; no backfill owed).
- The test reads `apps/api/drizzle/*.sql`, collects every `-- backfill:system-column:<key>` marker → set `B`.
- **Assertion:** for every `key` in `SYSTEM_COLUMN_DEFINITIONS`, `key ∈ BASELINE ∪ B`. A new key that is neither baseline nor backfilled fails with a message pointing at the `0080` template and the marker convention.
- `0080_backfill-geospatial-column-definitions.sql` gains `-- backfill:system-column:<key>` markers for its geospatial keys so `B` covers them (they can then leave the baseline set — the migration is now their proof).

### Chart wiring

**File: `deploy/helm/portalai/templates/upgrade-job.yaml`** (new) — models `migrate-job.yaml` but:
- `helm.sh/hook: pre-upgrade` (only), weight `-5`, `hook-delete-policy: before-hook-creation,hook-succeeded`, `backoffLimit: 6`.
- `command: ["node", "dist/scripts/db-upgrade.js"]`, same `envFrom` (config ConfigMap + secret) and security context as migrate-job.
- Gated on `{{- if .Values.upgrade.enabled }}`.

**`migrate-job.yaml`** — narrow its hook to `pre-install` (schema for the external-DB first-install path); the upgrade path now flows through `upgrade-job.yaml`. **`seed-job.yaml`** stays `post-install` (first-install global seed). *(One reviewer note: migrate logic exists at two lifecycle points — install vs upgrade genuinely differ in DB-readiness timing; the upgrade job is the single-signal path discovery chose.)*

**`values.yaml`** — add:
```yaml
upgrade:
  enabled: true   # runs db:upgrade (migrate + seed) on `helm upgrade`
```

**`NOTES.txt`** — append a post-upgrade block:
```
On upgrade, schema migrations + seeds run in one job before the API rolls:
  kubectl -n {{ .Release.Namespace }} logs job/{{ include "portalai.fullname" . }}-upgrade
It prints "UPGRADE COMPLETE" on success. Run `helm upgrade --atomic` so a failed
upgrade rolls the workloads back automatically (schema is expand-only and stays valid).
```

### `portalops db upgrade`

**File: `packages/devops-cli/src/commands/db.ts`** — add `dbUpgrade` mirroring `dbSeed` (`db.ts:230`): env-shape routing (deployed → `db:upgrade:ci` as an ECS one-off inside the container; local → spawn the app's `db:upgrade`). **No `deployMode` branching.** Same guard/exit-code contract as the other `portalops db` commands (`0` success, `7` infra-error, `4`/`3` auth/env per `packages/cli-env/src/errors.ts`); `app-dev` mutation needs `--yes`, `prod` needs `--yes --confirm-prod`. Wire the `db upgrade` subcommand in `packages/devops-cli/src/bin.ts` next to `db seed`. Update `packages/devops-cli/COMMANDS.md`.

## Migration

**No schema migration.** The only migration-file change is retroactive **comment markers** added to `apps/api/drizzle/0080_backfill-geospatial-column-definitions.sql` (SQL-inert `-- backfill:system-column:<key>` lines) — no DDL, no new file, no `db:generate`.

## Seed

No new seed data. `db:upgrade` **invokes** the existing `SeedService.seed()` (bootstrap-only, idempotent). This spec adds no `SYSTEM_COLUMN_DEFINITIONS` entries — it adds the guard that governs future ones.

## TDD test plan

Run via npm scripts (`feedback_use_npm_test_scripts`): `cd apps/api && npm run test:unit && npm run test:integration`; `cd packages/devops-cli && npm run test:unit`; root `npm run lint:migrations -- --self-test`.

The upgrade advisory lock is **not** re-tested here — its behavior (session-scoped, non-blocking, fail-closed, release-on-throw) is already covered by the `sync-lock` integration tests; case 3 below exercises it through `runUpgrade`.

### Layer 1 — `db:upgrade` entrypoint (apps/api integration)

1. `runUpgrade()` on a fresh DB applies pending migrations (`migrationsApplied > 0`), seeds, returns `acquiredLock: true, seedOk: true`.
2. A **second** `runUpgrade()` immediately after is a safe no-op: `migrationsApplied === 0`, `seedOk: true` (idempotent seed), exit-eligible `0`.
3. When the upgrade lock is already held (a concurrent `withAdvisoryLock(UPGRADE_LOCK_NAMESPACE, …)` on a second connection), `runUpgrade()` returns `acquiredLock: false` and performs no migrate/seed (spies assert zero calls).
4. A migrate failure propagates: `runUpgrade()` rejects/returns failure, the entrypoint would exit `1`, and the lock is released (a subsequent `runUpgrade` acquires) — `withAdvisoryLock`'s `finally` unlock.
5. Reuses the resolver path — `buildMigrationClientOptions`-style assertion that the upgrade migrate opens its connection with a password **callback**, not a static password (the #505 regression guard, mirrored).

### Layer 2 — `lint:migrations` (root, self-test)

6. `--self-test`: destructive statement without a marker → non-zero exit.
7. `--self-test`: destructive statement **with** `-- destructive-ok: <reason>` → pass.
8. `--self-test`: `-- destructive-ok:` with empty reason → fail.
9. `--self-test`: purely additive migration (`CREATE TABLE`, `ADD COLUMN`) → pass.
10. Running against the **real** `apps/api/drizzle/` tree passes (no unacknowledged destructive DDL exists today).

### Layer 3 — backfill coverage guard (apps/api unit)

11. Every current `SYSTEM_COLUMN_DEFINITIONS` key is in `BASELINE ∪ markers` — passes against the real tree (after `0080` markers land).
12. A synthetic key absent from baseline and markers **fails** the assertion (drive via a stubbed catalog list) with the template-pointing message.
13. The `0080` markers are discovered by the scanner (each geospatial key present in `B`).

### Layer 4 — `portalops db upgrade` (devops-cli unit)

14. `dbUpgrade` on a deployed env issues the ECS one-off `db:upgrade:ci` (mocked runner asserts the command), not a local spawn.
15. `dbUpgrade` on `local` spawns `db:upgrade` (mocked runner).
16. No `deployMode`-conditional branch in `dbUpgrade` (the routing key is env shape only) — asserted by exercising both a `saas` and a `residency`-config env of the same *shape* and getting the same routing.
17. `--json` success envelope on stdout; guard/exit-code contract honored (app-dev without `--yes` → usage/confirmation exit).

### Layer 5 — chart (lint:helm / template render)

18. `helm template` (or the existing `check-helm.mjs` guard extended) renders `upgrade-job.yaml` with `helm.sh/hook: pre-upgrade` and the `db-upgrade.js` command when `upgrade.enabled: true`; omits it when `false`.
19. `migrate-job.yaml` renders `pre-install` only; `seed-job.yaml` renders `post-install`; no template references a nonexistent value.

**Totals:** ~5 entrypoint + ~5 lint:migrations + ~3 backfill-guard + ~4 CLI + ~2 chart ≈ **19 cases** (the advisory lock reuses existing coverage).

## Acceptance criteria

- [ ] `helm upgrade` on an existing install runs migrations **and** seeds in one `pre-upgrade` job that prints `UPGRADE COMPLETE`; a re-run of an already-applied upgrade is a safe no-op (`migrations: 0`, seed unchanged) with exit `0`.
- [ ] Two concurrent `db:upgrade` runs never both migrate — the second reports `another upgrade is already running` and exits non-zero (advisory lock).
- [ ] A failed migrate makes the upgrade job exit non-zero (fail-closed); with `helm upgrade --atomic` the workloads roll back and the previous image runs against the expand-only schema.
- [ ] Adding a `SYSTEM_COLUMN_DEFINITIONS` entry **without** a paired backfill migration fails CI (backfill-coverage guard) — the #414 stranding is now a build failure, not a silent one.
- [ ] Destructive DDL in a new migration fails CI unless it carries `-- destructive-ok: <reason>`.
- [ ] `portalops db upgrade --env <env>` runs the same `db:upgrade` entrypoint via env-shape routing with no deploy-mode branch; residency installs upgrade via Helm without the CLI.
- [ ] `db:upgrade` does **not** converge tier policy — `portalops tier apply` remains the explicit path.
- [ ] `npm run lint`, `type-check`, `lint:migrations`, `lint:helm` all clean at repo root; existing suites green.

## Risks & rollback

| Risk | Mitigation |
|---|---|
| An xact-scoped lock would release between migration files, letting a second runner in mid-upgrade. | Reuse the **session-scoped** `SyncLockService.withAdvisoryLock` (`reserveConnection` + `pg_try_advisory_lock`, released in `finally`) — it holds the lock on its own reserved connection for the whole block (tests 3, 4). |
| A failed upgrade leaves a half-applied migration file. | drizzle wraps each migration file in a transaction; partial files never persist. Expand-only keeps the previous image valid under the new schema. |
| Destructive-DDL guard is too blunt and blocks a legitimate cleanup. | It's an **acknowledgment**, not a block — `-- destructive-ok: <reason>` lets an intentional post-deprecation drop through, deliberately and in-file (tests 12–13). |
| Backfill guard's baseline hides a real gap. | Baseline is a one-time literal for pre-guard keys; every **future** key must carry a marker (=migration). Test 17 proves a non-baseline, unmarked key fails. |
| Bundled-DB first install can't migrate at `pre-install` (existing caveat). | Unchanged — first install keeps `migrate-job` (`pre-install`, external-DB path per chart README) + `seed-job` (`post-install`); the new `upgrade-job` is `pre-upgrade` only, where a reachable DB is guaranteed. |
| `portalops db upgrade` fires against prod unguarded. | Inherits the `cli-env` guard (`prod` needs `--yes --confirm-prod`); test 22. |

**Rollback:** the feature is additive (new script, new job template, new guards, new CLI subcommand). Revert the branch; `upgrade.enabled` can also be set `false` to fall back to the prior migrate-only upgrade behavior. No data migration to unwind.

## Files touched

**`apps/api`** — new: `src/scripts/db-upgrade.ts`, `src/services/__tests__/seed-backfill-coverage.test.ts`, `src/__tests__/__integration__/scripts/db-upgrade.integration.test.ts`; edit: `src/services/sync-lock.service.ts` (+`UPGRADE_LOCK_NAMESPACE`), `package.json` (+`db:upgrade`/`db:upgrade:ci`), `drizzle/0080_backfill-geospatial-column-definitions.sql` (+markers).

**root** — new: `scripts/check-migrations.mjs`; edit: `package.json` (+`lint:migrations`), `.github/workflows/unit-test.yml` (run it).

**`deploy/helm/portalai`** — new: `templates/upgrade-job.yaml`; edit: `templates/migrate-job.yaml`, `templates/seed-job.yaml`, `templates/NOTES.txt`, `values.yaml`, `values.schema.json` (+`upgrade`), `README.md`; and `scripts/check-helm.mjs` if it enumerates templates.

**`packages/devops-cli`** — edit: `src/commands/db.ts` (+`dbUpgrade`), `src/bin.ts` (+`db upgrade`), `COMMANDS.md`, tests under `src/commands/__tests__/`.

**docs** — edit: `docs/PROD_DEPLOY.runbook.md`, `CLAUDE.md` (migration/backfill + upgrade path).

No new dependency. No env-var change. No API route change.

## Next step

`docs/FLEET_UPGRADE.plan.md` — TDD slices, each an independently green commit on `feat/581-fleet-upgrade` PR'd into `epic/enterprise-deployment`: (1) `db:upgrade` entrypoint (+`UPGRADE_LOCK_NAMESPACE`, reusing `withAdvisoryLock`) + scripts; (2) `lint:migrations` destructive-DDL guard + CI wiring; (3) backfill-coverage guard + `0080` markers; (4) chart `upgrade-job.yaml` + hook re-scoping + NOTES/values; (5) `portalops db upgrade`; (6) durable-doc updates. Slice 1 freezes the upgrade contract; 2–3 are independent guards that can land in parallel; 4–5 consume the entrypoint; 6 closes.

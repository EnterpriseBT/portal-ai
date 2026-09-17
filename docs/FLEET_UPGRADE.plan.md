# Self-contained fleet upgrade — Plan

**TDD-sequenced implementation of the per-install upgrade: a session-scoped `withGlobalLock`, the advisory-locked `db:upgrade` entrypoint (migrate → seed → signal), the `lint:migrations` destructive-DDL guard, the per-org backfill-coverage guard, the `pre-upgrade` chart job, the deployment-agnostic `portalops db upgrade`, and the doc-sync.**

Spec: `docs/FLEET_UPGRADE.spec.md`. Discovery: `docs/FLEET_UPGRADE.discovery.md`. Issue: #581 (epic #569). Builds on **shipped #566** (the L2 Helm chart with its `migrate-job`/`seed-job` hooks) and **#505/#500** (the resolver-aware `db-migrate.ts`), both live on `epic/enterprise-deployment`.

Seven slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/581-fleet-upgrade`** and PR back into `epic/enterprise-deployment` — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit && npm run test:integration
cd packages/devops-cli && npm run test:unit
npm run lint:migrations -- --self-test   # root
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the leaf lock is testable before the entrypoint that holds it; the two CI guards are independent of the runtime path and of each other; the chart and CLI both consume the finished entrypoint; docs close.

- **Slice 1** — `withGlobalLock` (pure infra primitive), no upgrade yet.
- **Slice 2** — `db:upgrade` entrypoint composes slice 1 + the existing migrate + seed; freezes the upgrade contract.
- **Slice 3** — `lint:migrations` destructive-DDL guard (pure SQL scan + self-test); independent, parallelizable with 4.
- **Slice 4** — backfill-coverage guard + `0080` markers; independent, parallelizable with 3.
- **Slice 5** — chart `upgrade-job.yaml` + hook re-scoping; consumes slice 2's `db:upgrade:ci`.
- **Slice 6** — `portalops db upgrade`; consumes slice 2 via env-shape routing.
- **Slice 7** — durable-doc sync (runbook, chart README, `CLAUDE.md`, `COMMANDS.md`).

No schema migration; the only `drizzle/` change is inert comment markers on `0080` (slice 4).

---

## Slice 1 — `withGlobalLock` + `GLOBAL_LOCK_KEYS`

A session-scoped advisory-lock primitive on a dedicated `max:1` connection. Nothing calls it yet.

**Files**

- Edit: `apps/api/src/db/advisory-lock.util.ts` — add `globalLockKey(name)`, `GLOBAL_LOCK_KEYS = { dbUpgrade }`, and `withGlobalLock(key, fn) → { acquired: true, value } | { acquired: false }` (dedicated non-pooled connection, `pg_try_advisory_lock` + `pg_advisory_unlock` in `finally`).
- New: `apps/api/src/db/__tests__/advisory-lock.global.integration.test.ts` — cases 1–5.

**Steps**

1. **Integration tests (spec cases 1–5).** free lock → `{ acquired: true, value }` runs `fn`; a second acquire on the same key while held → `{ acquired: false }`, `fn` not run; different keys don't contend; lock released after `fn` resolves **and** after `fn` throws (subsequent acquire succeeds); `globalLockKey` deterministic + distinct per name. Run; fail.
2. **Implement** `withGlobalLock` using a dedicated connection (the non-pooled pattern noted at `apps/api/src/db/client.ts:47`), password via `createDbPasswordResolver`; `globalLockKey` reuses `entityLockKey`'s SHA-256→signed-bigint derivation. Green.
3. Lint + type-check.

**Done when:** cases 1–5 pass; the primitive exists and is unreferenced elsewhere.

**Risk:** using `pg_advisory_xact_lock` by reflex — it would release between migration files. Test 4 (release-on-throw with a fresh connection) and the session-scoped `pg_try_advisory_lock`/`pg_advisory_unlock` pairing guard against it.

---

## Slice 2 — `db:upgrade` entrypoint + scripts

The advisory-locked migrate → seed operation with a structured summary + exit code. Freezes the upgrade contract slices 5–6 consume.

**Files**

- New: `apps/api/src/scripts/db-upgrade.ts` — `UpgradeSummary` + `runUpgrade()` + the entrypoint guard (mirrors `db-migrate.ts`).
- New: `apps/api/src/scripts/__tests__/db-upgrade.integration.test.ts` — cases 6–10.
- Edit: `apps/api/package.json` — `db:upgrade` (tsx) + `db:upgrade:ci` (`node dist/scripts/db-upgrade.js`).

**Steps**

1. **Integration tests (spec cases 6–10).** fresh DB → `migrationsApplied > 0`, `seedOk`, `acquiredLock`; immediate re-run → `migrationsApplied === 0`, `seedOk` (idempotent), exit-eligible 0; lock already held → `acquiredLock: false`, migrate/seed spies never called; migrate failure → failure result + lock released; connection opens with a password **callback** not a static password (the #505 regression guard). Run; fail.
2. **Implement** `runUpgrade()` — `withGlobalLock(GLOBAL_LOCK_KEYS.dbUpgrade, …)` wrapping: `runMigrations()` (reused from `db-migrate.ts`), `migrationsApplied` from a `SELECT count(*) FROM drizzle.__drizzle_migrations` delta, then `new SeedService().seed()`; emit the summary + final `UPGRADE COMPLETE (migrations: N, seed: ok)` / `UPGRADE FAILED: <reason>`. Entrypoint maps to exit 0/1 (0 only when `acquiredLock && seedOk && migrate ok`). Green.
3. Lint + type-check.

**Done when:** cases 6–10 pass; `db:upgrade`/`db:upgrade:ci` run locally; the contract is frozen.

**Risk:** `runMigrations()` currently ends its own `sql` connection and drizzle's `migrate()` manages transactions — confirm it composes inside the outer lock's session (the lock is on a *separate* dedicated connection, so migrate's own connection lifecycle is independent; the lock only needs to outlive the whole block). Confirm reading `drizzle.__drizzle_migrations` (internal table, stable in practice) — acceptable per spec (log-only count).

---

## Slice 3 — `lint:migrations` destructive-DDL guard

A root guard script (the `check-ci-cache.mjs`/`check-helm.mjs` family) that fails on unacknowledged destructive DDL. Independent of the runtime path.

**Files**

- New: `scripts/check-migrations.mjs` — scan + `-- destructive-ok:` acknowledgment + embedded `--self-test` fixtures.
- Edit: root `package.json` — `"lint:migrations": "node scripts/check-migrations.mjs"`.
- Edit: `.github/workflows/unit-test.yml` — run `lint:migrations` beside `lint:ci-cache`/`lint:helm`.

**Steps**

1. **Self-test cases (spec 11–15).** destructive statement without a marker → non-zero; same with `-- destructive-ok: <reason>` → pass; empty-reason marker → fail; purely additive migration → pass; the **real** `apps/api/drizzle/` tree passes. Run `node scripts/check-migrations.mjs --self-test`; fail (script absent).
2. **Implement** the scanner: comment-strip, match `DROP TABLE|DROP COLUMN|ALTER … DROP|DROP … CONSTRAINT|TRUNCATE|ALTER COLUMN … TYPE` (case-insensitive), require a non-empty `-- destructive-ok:` on the statement or the line above, self-test fixtures run before the real tree. Green.
3. Wire into CI; lint + type-check (the script is `.mjs`, exempt from TS but must pass repo prettier/eslint globs if included).

**Done when:** `--self-test` passes, the real tree passes, and the check is a CI step.

**Risk:** false positives on a legitimately additive statement containing a matched keyword in a string/comment — the comment-strip + statement-boundary parsing (not raw substring) mitigates; a fixture asserts an additive migration passes.

---

## Slice 4 — backfill-coverage guard + `0080` markers

Make a per-org seed entry without a paired backfill migration a build failure (#414 enforcement). Independent of slice 3.

**Files**

- New: `apps/api/src/services/__tests__/seed-backfill-coverage.test.ts` — cases 16–18 + `BASELINE_SYSTEM_COLUMN_KEYS`.
- Edit: `apps/api/drizzle/0080_backfill-geospatial-column-definitions.sql` — add `-- backfill:system-column:<key>` markers for its geospatial keys (SQL-inert).

**Steps**

1. **Unit tests (spec cases 16–18).** every real `SYSTEM_COLUMN_DEFINITIONS` key ∈ `BASELINE ∪ markers`; a synthetic non-baseline unmarked key **fails** (stub the catalog list) with the template-pointing message; the `0080` markers are discovered by the scanner. Run; fail.
2. **Implement** the test's scanner (read `apps/api/drizzle/*.sql`, collect `-- backfill:system-column:<key>` → `B`), define `BASELINE_SYSTEM_COLUMN_KEYS` as the pre-guard key literal, assert coverage. Add the markers to `0080`. Green.
3. Lint + type-check.

**Done when:** cases 16–18 pass against the real tree; a new unmarked key would fail CI.

**Risk:** getting the baseline wrong strands a genuine gap. The baseline is exactly today's key set; the geospatial keys move into `B` via the `0080` markers so they're proven-by-migration, not baseline-exempt. Reviewer note in the test explains the split.

---

## Slice 5 — chart `upgrade-job.yaml` + hook re-scoping

The upgrade path becomes one `pre-upgrade` job with one operator signal. Consumes slice 2's `db:upgrade:ci`.

**Files**

- New: `deploy/helm/portalai/templates/upgrade-job.yaml` — `pre-upgrade` hook, weight `-5`, `command: ["node", "dist/scripts/db-upgrade.js"]`, gated on `.Values.upgrade.enabled`.
- Edit: `templates/migrate-job.yaml` (narrow to `pre-install`), `templates/seed-job.yaml` (stays `post-install`), `templates/NOTES.txt` (post-upgrade block), `values.yaml` (+`upgrade.enabled: true`), `values.schema.json` (+`upgrade`), and `scripts/check-helm.mjs` if it enumerates templates.

**Steps**

1. **Render tests (spec cases 23–24).** via `check-helm.mjs` (extend) or a `helm template` assertion: `upgrade-job.yaml` renders the `pre-upgrade` hook + the `db-upgrade.js` command when `upgrade.enabled: true`, omits it when `false`; `migrate-job` = `pre-install` only; `seed-job` = `post-install`; no template references a missing value. Run; fail.
2. **Implement** the new template + hook re-scoping + `values`/`schema`/`NOTES` edits. Green.
3. `npm run lint:helm`; lint + type-check.

**Done when:** cases 23–24 pass; `helm template` produces a valid `upgrade-job` on upgrade and the install path is unchanged.

**Risk:** re-scoping `migrate-job` to `pre-install` could regress an external-DB install that relied on `pre-upgrade` migrate — but the new `upgrade-job` now owns `pre-upgrade`, so the upgrade path is covered; the install path is unchanged. Called out in the spec's chart note.

---

## Slice 6 — `portalops db upgrade`

A deployment-agnostic CLI wrapper over the same entrypoint. Consumes slice 2 via env-shape routing.

**Files**

- Edit: `packages/devops-cli/src/commands/db.ts` — `dbUpgrade(def, opts, runScript)` mirroring `dbSeed` (`db.ts:230`): deployed → ECS one-off `db:upgrade:ci`; local → spawn `db:upgrade`. No `deployMode` branch.
- Edit: `packages/devops-cli/src/bin.ts` — wire the `db upgrade` subcommand beside `db seed`.
- New/extend: `packages/devops-cli/src/commands/__tests__/db.upgrade.test.ts` — cases 19–22.

**Steps**

1. **Unit tests (spec cases 19–22).** deployed env → ECS one-off `db:upgrade:ci` (mock runner); `local` → spawn `db:upgrade`; a `saas` and a `residency` env of the same *shape* route identically (no deploy-mode branch); `--json` success envelope on stdout + the guard/exit-code contract (`app-dev` without `--yes` → confirmation exit). Run; fail.
2. **Implement** `dbUpgrade` + the subcommand wiring, honoring the `cli-env` guard (`prod` → `--yes --confirm-prod`) and the exit-code contract (`packages/cli-env/src/errors.ts`). Green.
3. Lint + type-check.

**Done when:** cases 19–22 pass; `portalops db upgrade --env <env>` runs the entrypoint via env-shape routing.

**Risk:** duplicating deploy-mode logic into the CLI (the exact anti-pattern the memory + spec forbid). Test 21 asserts identical routing across `saas`/`residency` of one env shape.

---

## Slice 7 — durable-doc sync

The documented capabilities now include an upgrade path — update the durable surfaces in the same PR (`CLAUDE.md` → "Keeping Documentation in Sync").

**Files**

- Edit: `docs/PROD_DEPLOY.runbook.md` (the `db:upgrade` path + `--atomic` guidance), `deploy/helm/portalai/README.md` (upgrade section), `CLAUDE.md` (migration/backfill sections: the `db:upgrade` entrypoint, the two guards, the marker convention), `packages/devops-cli/COMMANDS.md` (`db upgrade`).

**Steps**

1. Update the four surfaces to describe the shipped behavior (one upgrade path; guards; markers; tiers stay explicit).
2. Lint (markdown is unformatted per `CLAUDE.md`, but `lint:doc-pointers` gates durable-doc citations — run it); type-check unaffected.

**Done when:** the durable docs describe the shipped upgrade path; `lint:doc-pointers` clean.

**Risk:** none (docs). No phase-doc citations (those are exempt).

---

## Sequence summary

| Slice | Lands | Spec cases | Tests |
|---|---|---|---|
| 1 | `withGlobalLock` + `GLOBAL_LOCK_KEYS` | 1–5 | api integration |
| 2 | `db:upgrade` entrypoint + scripts | 6–10 | api integration |
| 3 | `lint:migrations` destructive-DDL guard | 11–15 | root self-test + CI |
| 4 | backfill-coverage guard + `0080` markers | 16–18 | api unit |
| 5 | chart `upgrade-job.yaml` + hook re-scoping | 23–24 | lint:helm / render |
| 6 | `portalops db upgrade` | 19–22 | devops-cli unit |
| 7 | durable-doc sync | — | lint:doc-pointers |

Total ≈ **24 cases**, no schema migration. Commits on `feat/581-fleet-upgrade`; PR into `epic/enterprise-deployment` grows commit-by-commit.

## Cross-slice notes

- **No schema migration.** The only `drizzle/` change is inert comment markers on `0080` (slice 4). `db:generate` is never run.
- **Slices 3 and 4 are order-independent** — both are CI guards touching neither the runtime path nor each other. Either can land first; both must be green before slice 5 to keep CI honest.
- **The lock is on a separate connection from migrate.** `withGlobalLock` holds its own `max:1` session; `runMigrations()` opens and closes its own. The lock only needs to outlive the whole `runUpgrade` block — no shared-connection coupling (slice 2 risk note).
- **Expand-only is a convention, backed at the boundary by the destructive-DDL guard** (slice 3) — an accidental drop fails CI; an intentional one is acknowledged in-file. There is no schema-rollback path by design (forward-only).
- **First-install path is untouched** — `migrate-job` (`pre-install`) + `seed-job` (`post-install`) still handle a fresh install; only the upgrade path is new (slice 5). Guards the bundled-DB timing caveat.
- **CLI stays deployment-agnostic** (`feedback_clis_deployment_agnostic`) — slice 6 routes by env shape only; residency upgrades via Helm (slice 5) and never invokes the CLI.
- **Doc-sync is a real slice, not a footnote** (slice 7) — the upgrade path is a documented capability across the runbook, chart README, `CLAUDE.md`, and `COMMANDS.md`.
- **CLAUDE.md compliance:** file suffixes (`*.util.ts`, `db-upgrade.ts` script, `*.test.ts`), server-enforced guards (CI, not prompt), advisory-lock reuse of the #460 pattern, and the doc surfaces all hold. No SDK change; the one new env-independent script pair rides `package.json`.

## Next step

Implement slice 1 on `feat/581-fleet-upgrade`, tests-first, once discovery + spec + plan are confirmed. Before coding, re-read the spec's *Surface* skeletons — they're faithful to the shipped `advisory-lock.util.ts`, `db-migrate.ts`, `SeedService`, the chart templates, and the `portalops db` command shape; lift, don't reinvent.

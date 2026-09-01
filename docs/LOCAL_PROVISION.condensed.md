# portalops one-shot local provisioning — Condensed design (#490)

**Issue:** [EnterpriseBT/portal-ai#490](https://github.com/EnterpriseBT/portal-ai/issues/490) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** After `docker compose down -v` + rebuild, `db:migrate` + `db:seed` leaves local with only the bootstrap `standard` tier — `tier apply` (paid tiers + env-local Stripe price ids) is a separate, undocumented step. One command composes the existing pieces so "fresh reset → fully provisioned local" is a single, idempotent, documented invocation. Packages touched: `packages/devops-cli` (+ two docs).

## Current shape

| Piece | Location | Note |
|---|---|---|
| `dbSeed` (local path spawns `db:seed`) | `packages/devops-cli/src/commands/db.ts:259` | env-shape dispatch (#295); guards + audits itself |
| `tierApply` (Stripe resolve → diff → tx) | `packages/devops-cli/src/commands/tier.ts:306` | fail-closed `TierApplyMissingPricesError` → exit 8; local reads `STRIPE_SECRET_KEY` from process env |
| `runApiScript` (spawn app script, `DATABASE_URL` injected) | `packages/cli-env/src/spawn.ts:55` | injection wins over the script's `dotenv -e .env`; non-zero exit → `EnvInfraError` |
| App scripts `db:migrate` / `db:seed:org` | `apps/api/package.json:28,38` | `db:seed:org --name e2e-fixture --member-email <email>`; requires the user row to exist (first login) |
| Exit-code map + `--json` envelope | `packages/devops-cli/src/output.ts:10` | `TIER_APPLY_MISSING_PRICES` → 8 already mapped |
| bin wiring / `common()` flags / `execute()` | `packages/devops-cli/src/bin.ts:54,62` | `CommanderError` → exit 2 via `runCli` (`bin.ts:410`) |
| `seedTiers` bootstrap-only rationale | `apps/api/src/services/seed.service.ts:371` | seed never converges an existing row — why apply is a mandatory step |

## Decision — command placement, env gate, and failure shape

**Placement: `portalops local provision`**, implemented as `localProvision(def, opts, deps)` in a new `src/commands/local.ts`. Not `db provision` (the command spans db *and* tier/Stripe) and not a bare top-level `provision` (it is local-only by contract; the `local` group is the honest namespace and gives future local-only helpers a home).

**Env gate: commander-level.** The subcommand declares its own `--env` restricted via `new Option("--env <name>").choices(["local"])` instead of `common()`'s free-form `--env`. `--env app-dev`/`prod` then fails as a usage error (`CommanderError` → exit 2 in `runCli`) before any env resolution or connection — exactly the "exit 2 before touching anything" the ticket requires. Other shared flags (`--json`, `--yes`) stay.

**Steps, in order, each delegating to the existing implementation (never reimplemented):**
1. `migrate` — `runApiScript(def, "db:migrate", [])` (drizzle applies pending, no-ops when current).
2. `seed` — `dbSeed(def, opts)` (system rows; guards + audits itself).
3. `tier-apply` — `tierApply(def, opts)` (catalog tiers + Stripe price ids; fail-closed).
4. `e2e-org` — only with `--e2e-org [member-email]`: `runApiScript(def, "db:seed:org", ["--name", "e2e-fixture", "--member-email", <email>])`; idempotent-by-name. Flag omitted → step reported `skipped`. Email resolution: explicit flag value wins; a bare `--e2e-org` defaults from `E2E_AUTH0_USERNAME` in the process env (export it, or prefix with `dotenv -e packages/e2e/.env --`); neither present → usage error (exit 2) before any step runs. No file read of `packages/e2e/.env` from devops-cli — the env var is the interface.

**Failure shape: per-step payload, not the bare error envelope.** Result is `{ steps: [{ name, status: "ok"|"skipped"|"failed", result?, error?: {code,message} }] }`. A step failure stops the run, marks that step `failed` with the underlying `{code,message}`, keeps earlier steps' results, and the bin sets `process.exitCode = exitCodeFor(stepError)` — so a missing Stripe price exits 8 with steps 1–2 still reported on stdout. This deviates from `execute()`'s either-payload-or-envelope shape deliberately (the ticket requires earlier results to survive a later step's failure); COMMANDS.md documents it. Human render: one line per step on stdout, summary verdict last. One `recordAudit` line for the provision invocation itself; steps 2–3 already audit individually.

**Guards:** standard `assertOperationAllowed` via the delegated steps (a no-op confirmation-wise on `local`'s development kind); `--yes` accepted and documented for muscle-memory parity. `.claude` allowlist not extended.

**Prerequisites (documented, not auto-fixed):** `DATABASE_URL` in the shell (local env connection) and `STRIPE_SECRET_KEY` (tier step) — both surface as their existing typed errors if absent.

## Plan — 2 slices

**Slice 1 — `feat(devops-cli): portalops local provision (#490)`**
- New: `packages/devops-cli/src/commands/local.ts` — `localProvision(def, opts: MutateOptions & { e2eOrgEmail?: string }, deps)` with injectable `{ runScript?, seed?, apply? }` seams (same pattern as `dbSeed`/`tierApply` deps); returns the per-step result; stops on first failure carrying the error code.
- Edit: `packages/devops-cli/src/bin.ts` — `local` group + `provision` subcommand (`--env` choices `["local"]`, `--e2e-org [member-email]` with `E2E_AUTH0_USERNAME` fallback, `--json`, `--yes`), human renderer, exit-code from failed step.
- Edit: `packages/devops-cli/src/index.ts` — export the new command module.
- Tests: new `packages/devops-cli/src/__tests__/local.test.ts` — step order; all-ok payload; `--e2e-org` present/absent (`skipped`); tier failure → steps 1–2 intact + `TIER_APPLY_MISSING_PRICES` code surfaced; e2e-org script failure → earlier steps intact, `ENV_INFRA_ERROR`. Edit `bin.test.ts` — `--env app-dev` → exit 2 with no step run; bare `--e2e-org` resolves from `E2E_AUTH0_USERNAME` (and exits 2 when unset, no step run); happy-path wiring; `--json` payload shape. Run via `npm run test:unit -w @portalai/devops-cli`, plus `lint`/`type-check`.

**Slice 2 — `docs(devops-cli): document local provision + reset runbook (#490)`**
- Edit: `packages/devops-cli/COMMANDS.md` — `## local` section: contract, step table, `--json` shape incl. the per-step failure deviation, prerequisites.
- Edit: `docs/LOCAL_DEVELOPMENT.md` — new "Fresh reset → fully provisioned" section naming the one command (and the separate interactive `e2e:auth` step it deliberately excludes).

## Smoke (manual, against your dev stack)

1. Wipe: `portalops db reset --env local --yes` (or a real `docker compose down -v` + rebuild + empty DB), then `DATABASE_URL=… STRIPE_SECRET_KEY=… portalops local provision --env local --yes` → exit 0; human output lists migrate/seed/tier-apply `ok`, e2e-org `skipped`; Settings → Subscription (or `db psql`) shows all four tiers with `plus`/`pro` carrying local price ids.
2. Re-run the same command → exit 0, every step `ok`/`noop`, `tier apply` reports no changes.
3. `portalops local provision --env app-dev --yes` → exit 2, no banner/connection.
4. With `STRIPE_SECRET_KEY` unset → exit 8; `--json` stdout still carries migrate + seed results with the tier step `failed: TIER_APPLY_MISSING_PRICES`-family error.
5. `--e2e-org bogus@example.com` (user never logged in) → e2e-org step fails with the "User … not found" message; earlier steps' results intact. Bare `--e2e-org` with `E2E_AUTH0_USERNAME` exported (the real logged-in user) seeds `e2e-fixture`, and a re-run is a no-op; bare `--e2e-org` with the var unset → exit 2, nothing run.

## Out of scope

- Changing `db:seed` semantics (bootstrap-only tier seed stays, #218); creating Stripe prices (price runbook unchanged); deployed-env provisioning (`db:seed:ci` / nightly apply); `e2e:auth` session capture (interactive); `.claude` allowlist changes.

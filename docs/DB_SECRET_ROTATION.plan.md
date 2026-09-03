# Rotation-proof database credentials — Plan

**TDD-sequenced implementation of the password resolver, the postgres-js dynamic-password wiring, the cli-env live composition, and the CFN grant — ending the 7-day prod DB degradation.**

Spec: `docs/DB_SECRET_ROTATION.spec.md`. Discovery: `docs/DB_SECRET_ROTATION.discovery.md`. Issue: #500. Builds on shipped #384 (`DbMasterSecretArn` export + `db url` compose logic) — both live on `main`.

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `fix/db-secret-rotation`** — one fix, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd apps/api && npm run test:integration
cd packages/cli-env && npm run test:unit
cd packages/devops-cli && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run (`--testPathPattern`, touched files only — the full suite is CI's job); (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:

- **Slice 1** — the resolver is pure leaf logic (mocked SDK); nothing references it yet. The new dep lands here.
- **Slice 2** — wires the resolver into the pool and pins the load-bearing postgres-js behavior (password-fn overrides the URL) with real-Postgres integration tests. App is rotation-proof at this boundary for any env that sets the ARN — which none do until slice 4, so nothing changes in deployed behavior yet.
- **Slice 3** — cli-env/devops-cli are independent of 1–2 but sequenced after so the branch reads app-first; fixes the operator path (`tunnel`/`psql`).
- **Slice 4** — CFN + parity guard + docs sync last: it activates slices 1–2 in AWS envs, and the guard test pins the two infra lines the app now silently depends on.

---

## Slice 1 — `createDbPasswordResolver` (pure util + dep)

The TTL-cached, single-flight, fail-open resolver — spec §Surface `credentials.util.ts`, verbatim contract.

**Files**

- New: `apps/api/src/db/credentials.util.ts` — `DbPasswordResolverOptions`, `DbPasswordResolver`, `createDbPasswordResolver`.
- New: `apps/api/src/__tests__/db/credentials.util.test.ts` — spec cases 1–8.
- Edit: `apps/api/package.json` — add `@aws-sdk/client-secrets-manager` (version aligned with the existing `@aws-sdk/client-s3`/`client-ssm` majors); lockfile.

**Steps**

1. **Tests (spec cases 1–8).** No-ARN constant path (SDK constructor spy never called); fetch+parse+cache (one send per TTL); TTL expiry re-fetch + `rotation absorbed` warn on changed password; single-flight (5 concurrent → 1 send); fail-open on throw and on missing-`password` JSON (warn, last-known-good, else fallback, never rejects); `invalidate()` semantics; `ttlMs` override. Mock the SDK client via constructor injection (`opts.client`). Run; fail.
2. **Implement** the util per the spec skeleton — module logger `db-credentials`, structured warn fields `{ secretArn, cause }`. Green.
3. Lint + type-check.

**Done when:** cases 1–8 pass; nothing imports the util yet; local/dev behavior untouched.

**Risk:** none — pure code behind an injected client.

---

## Slice 2 — Pool wiring + env vars + the postgres-js behavior pins

`client.ts` gains the `password` option; the two integration tests pin that postgres-js consults the fn per connection and lets it override the URL — the assumption the whole design rests on, guarded against upgrades.

**Files**

- Edit: `apps/api/src/db/client.ts` — resolver construction (ARN + fallback from the URL's decoded password + TTL from env), `password: () => passwordResolver.resolve()` added to the existing `postgres(environment.DATABASE_URL, {...})` options (`client.ts:15-19`); `connectDatabase()` catch calls `passwordResolver.invalidate()` before rethrow. No signature changes to `db`/`reserveConnection`/`connectDatabase`/`closeDatabase`.
- Edit: `apps/api/src/environment.ts` — `DB_MASTER_SECRET_ARN`, `DB_PASSWORD_CACHE_TTL_MS` (after `DATABASE_URL`, `environment.ts:21`).
- New: `apps/api/src/__tests__/__integration__/db/dynamic-password.integration.test.ts` — spec cases 9–10.

**Steps**

1. **Integration tests (spec cases 9–10).** Build a throwaway `postgres()` pool against the integration Postgres with a deliberately wrong URL password: (9) `password` fn returning the correct one → `SELECT 1` succeeds; (10) fn returning a wrong one → rejects with password-auth error (`28P01`). Run; fail (no wiring yet — write them against the raw `postgres` import so they are green as soon as the behavior holds; they pin the library, not `client.ts`). Then a small unit assertion that `client.ts` constructs the resolver with the URL's decoded password as fallback (exported for test or via module mock). Run; fail.
2. **Implement** the `client.ts` + `environment.ts` edits. Green.
3. Lint + type-check. `npm run test:integration -- --testPathPattern dynamic-password`.

**Done when:** cases 9–10 pass against real Postgres; with no `DB_MASTER_SECRET_ARN` set (local, CI) the resolver is a constant and zero SDK traffic occurs — existing integration suite green unchanged.

**Risk:** the boot-time `new URL(DATABASE_URL)` on a malformed local URL — guard with the same tolerance as today (empty fallback when unparseable; the pool would fail exactly as it does now).

---

## Slice 3 — cli-env composes live; devops-cli delegates

Kills the operator half of the staleness: `tunnel`/`psql` authenticate with the current password always.

**Files**

- Edit: `packages/cli-env/src/aws.ts` — new `composeDatabaseUrl(def, opts?)` (logic lifted from `devops-cli/src/commands/db.ts:105-160`); **delete `getDatabaseUrl`** (`aws.ts:151-153`; clean cut, no alias).
- Edit: `packages/cli-env/src/connection.ts` — `db()` calls `composeDatabaseUrl(def)` (`connection.ts:82`); local branch untouched.
- Edit: `packages/devops-cli/src/commands/db.ts` — `dbUrl()` delegates composition to `composeDatabaseUrl`, keeping `--write`/audit/redaction verbatim.
- Edit: cli-env + devops-cli test suites — spec cases 11–14.

**Steps**

1. **Tests (spec cases 11–14).** `composeDatabaseUrl` shape + percent-encoding round-trip of `@:/#?` passwords; missing export / non-JSON secret → `EnvInfraError` with the actionable message; `resolveEnvConnection().db()` uses the compose (mocked aws layer); `db url` output shape unchanged (redacted; `--write` path still `putSecret`s). Run; fail.
2. **Implement** the move + delegation + deletion. Green (both packages).
3. Lint + type-check; rebuild dist is NOT needed for tests, but note the stale-dist rule for any manual CLI run afterward.

**Done when:** cases 11–14 pass; `getDatabaseUrl` no longer exists (compile-time proof); `db psql` against a live env authenticates post-rotation with no `--write` (manually verified in the smoke, not here).

**Risk:** hidden second consumer of `getDatabaseUrl`. Compile catches it — if one exists, it switches to `composeDatabaseUrl` in this slice, not to a shim.

---

## Slice 4 — CFN grant + env import + parity guard + docs sync

Activates runtime resolution in AWS envs and pins the infra lines in a test.

**Files**

- Edit: `infra/cloudformation/backend.yml` — container `Environment` gains `DB_MASTER_SECRET_ARN` ← `!ImportValue ${Environment}-DbMasterSecretArn` (Redis-import precedent, `backend.yml:563-568` shape); **task role** policy gains the `secretsmanager:GetSecretValue` on `secret:rds!*` statement (mirroring the execution role's `backend.yml:287-305`, same comment style).
- Edit: `packages/devops-cli/src/__tests__/deploy-parity.test.ts` (or a sibling yaml-pin test if parity doesn't parse `backend.yml`) — spec case 15.
- Edit: `docs/PROD_PROVISIONING.runbook.md` §10 + `docs/DEPLOYED_ENV_CONFIG.md` — the new contract (`database-url` bootstrap-only; `DB_MASTER_SECRET_ARN` row).

**Steps**

1. **Test (spec case 15).** Parse `backend.yml`; assert the task definition injects `DB_MASTER_SECRET_ARN` and the **task role** (not just execution role) grants `GetSecretValue` on `secret:rds!*`. Run; fail.
2. **Implement** the two YAML additions. Green.
3. Docs sync (runbook §10 note + env-config row). Lint + type-check; `npm run lint:doc-pointers`.

**Done when:** case 15 passes; the YAML diff is exactly two blocks; docs describe the shipped contract.

**Risk:** ImportValue when the database stack export is missing — fails the *deploy* loudly, not runtime; both envs already export it (#384, verified live during #495).

---

## Sequence summary

| Slice | Lands | Spec cases | Suite |
|---|---|---|---|
| 1 | resolver util + SDK dep | 1–8 | api unit |
| 2 | pool `password` option + env vars + library pins | 9–10 | api integration |
| 3 | `composeDatabaseUrl` + CLI delegation, `getDatabaseUrl` deleted | 11–14 | cli-env + devops-cli unit |
| 4 | CFN grant/import + parity guard + docs | 15 | devops-cli unit + doc-pointer lint |

Total ≈ **15 cases**, no migration. Commits on `fix/db-secret-rotation`; draft PR opens after the docs commits, grows per slice.

## Cross-slice notes

- **Nothing activates until slice 4 deploys**: slices 1–2 are inert without `DB_MASTER_SECRET_ARN` in the task env, so partial merges are safe and local/CI behavior is byte-identical throughout.
- **Rollout after merge (operator + agent, gated by the smoke doc `/smoke 500` scaffolds):** deploy app-dev → **forced-rotation smoke** (`aws secretsmanager rotate-secret` on app-dev's `rds!` secret; observe absorption within one TTL, `rotation absorbed` warn, `db psql` working with no `--write`) → deploy prod **before 2026-09-08** so the natural rotation is the closing observation. If the merge slips past the 8th, run the manual repair that morning (`db url --write` + forced deployment) and proceed — deadline pressures sequencing, not design.
- **The forced-rotation step immediately rotates app-dev's real DB password** — that is the point, and slices 1–3 make it a non-event, but it is the one smoke step with teeth; the smoke doc marks it accordingly.
- **Dep hygiene:** the SDK dep + lockfile land in slice 1 only; later slices must not touch `package.json`.
- **Local test-run discipline:** touched paths only (`--testPathPattern credentials|dynamic-password|compose|deploy-parity`); full suites are CI's.
- **Doc-sync inventory** (CLAUDE.md rule): runbook §10 + `DEPLOYED_ENV_CONFIG.md` in slice 4; no user-facing copy, no CLAUDE.md convention change; the `#495` memory note about the weekly repair loop becomes obsolete at prod deploy (retire it then).

## Next step

Implementation starts at slice 1 on this branch, tests-first, once you confirm discovery + spec + plan.

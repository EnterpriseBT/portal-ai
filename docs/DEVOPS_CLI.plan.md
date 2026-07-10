# DevOps CLI — Plan

**TDD-sequenced port of `api-cli.sh` to `portalops`: cli-env write primitives + the catalog and `vars` reads, then `vars` writes with guards/audit, then the `db` group + bin/exit codes, then docs + smoke + retirement.**

Spec: `docs/DEVOPS_CLI.spec.md`. Discovery: `docs/DEVOPS_CLI.discovery.md`. Issue: #192 (epic #191). Builds on shipped #194 (`@portalai/cli-env`) — registry, tunnel, guards, audit, `resolveEnvConnection` are consumed, not built.

Four slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/devops-cli` / PR #196** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd packages/cli-env && npm run test:unit
cd packages/devops-cli && npm run test:unit    # test:integration is "true"; live paths = manual smoke
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale:
- **Slice 1** — the cli-env write primitives land first (smallest, in an already-shipped package) plus the devops-cli scaffold, catalog and `vars` reads: everything later slices import, nothing destructive yet.
- **Slice 2** — `vars` writes: first guarded+audited mutations, exercising slice 1's put* end to end.
- **Slice 3** — the `db` group + `bin.ts` wiring + the exit-code contract: the riskiest logic (reset partitioning, ECS seed) lands once the output/guard scaffolding is proven.
- **Slice 4** — docs + smoke + retirement: prose and deletions last, after the smoke validates the live paths the deletions depend on.

---

## Slice 1 — cli-env put*/decryption + scaffold + catalog + `vars` reads

**Files**

- Edit: `packages/cli-env/src/aws.ts` — `putSecret` (update-or-create, `{created}`), `putParam` (Overwrite+Type), `getParam` + `WithDecryption: true`; barrel export.
- Edit: `packages/cli-env/src/__tests__/aws.test.ts` — the ≈5 new cases.
- New: `packages/devops-cli/` scaffold (package.json with `bin: portalops`, tsconfigs, jest, eslint — cloned from cli-env; deps: cli-env, commander, zod).
- New: `src/catalog.ts` (CATALOG data + `lookupKey` + `pathFor` + `mask`), `src/commands/vars.ts` (describe/list/get only), `src/output.ts` (banner-to-stderr, `--json` envelope helpers), `src/index.ts`.
- New: `src/__tests__/catalog.test.ts`, `src/__tests__/vars.test.ts` (read cases).

**Steps**

1. **Tests (spec: cli-env ≈5, catalog ≈5, vars reads ≈5).** put* behaviors incl. create-warn path + `WithDecryption`; the 16-entry catalog pin; mask rules; describe fetches no values; list masked vs `--unmask` + `(unset)` + `--json` shape; get returns raw. Run; fail.
2. **Implement.** Green.
3. Lint + type-check both packages; confirm turbo picks up the new package.

**Done when:** cli-env suite (≈53) + the new devops suites green; no mutation paths exist yet.

**Risk:** none — reads + data.

---

## Slice 2 — `vars` writes: set / apply / template (guards + audit)

**Files**

- Edit: `src/commands/vars.ts` — `setVar` (stdin `-`, refuse-empty, created-secret warn), `applyVars` (env-file parse, validate-all-before-any-write, quote stripping), `templateVars` (default name, refuse-overwrite, 0600, plaintext warning).
- Edit: `src/__tests__/vars.test.ts` — the ≈6 write cases (guards + audit asserted via mocked cli-env).

**Steps**

1. **Tests (spec: vars writes ≈6).** set/apply/template behaviors; `assertOperationAllowed` called with mutation class; `recordAudit` called per mutation; apply aborts wholesale on one bad line. Run; fail.
2. **Implement.** Green.
3. Lint + type-check.

**Done when:** the full `vars` surface matches the spec table; every mutation guarded + audited.

**Risk:** env-file parsing edge cases — the bash's quote-strip/trim rules are ported verbatim (tests pin them).

---

## Slice 3 — `db` group + `bin.ts` + the exit-code contract

**Files**

- New: `src/reset.ts` (pg_tables query → partition `er__*`/rest, excl. `__drizzle_migrations` — #106 pointer comment), `src/ecs.ts` (DescribeServices → DescribeTaskDefinition → RunTask override → waitUntilTasksStopped → exit code), `src/commands/db.ts` (tunnel/psql/reset/seed/reset-seed over `resolveEnvConnection`).
- New: `src/bin.ts` — commander wiring: global flags, required `--env`, guard application per command class, exit-code mapping, `--json` error envelope.
- Edit: `package.json` — add `@aws-sdk/client-ecs`.
- New: `src/__tests__/reset.test.ts`, `src/__tests__/ecs.test.ts`, `src/__tests__/db.test.ts`, `src/__tests__/bin.test.ts`.

**Steps**

1. **Tests (spec: db ≈10, bin ≈4).** Reset partitioning + destructive guard (prod blocked, staging `--yes`); seed happy/non-zero/local-pointer; psql passthrough argv + missing-binary; tunnel/psql prod `--confirm-prod`; bin: `--env` required, exit codes 3/5/6, JSON error envelope on stdout with banner on stderr. Run; fail.
2. **Implement** (mocked ECS client, `child_process`, cli-env seams). Green.
3. Lint + type-check; `npm run build` → verify `dist/bin.js` is executable and `npx portalops --help` renders from the workspace.

**Done when:** all ≈35 spec cases green across both packages; the bin runs locally.

**Risk:** ECS waiter mocking (use the client-mock pattern from cli-env's tests); commander exit-code override (`exitOverride` + explicit `process.exitCode`) — pinned by bin tests.

---

## Slice 4 — Docs + smoke + retirement + doc-sync

**Files**

- New: `packages/devops-cli/README.md` (human docs incl. the quickstart before→after table), `packages/devops-cli/COMMANDS.md` (agent reference: synopsis/flags/`--json` shapes/exit codes per command).
- New: `docs/DEVOPS_CLI.smoke.md` — manual checklist (tunnel, psql one-shot, reset `--env local`, seed against app-dev, vars round-trip incl. template 0600, guards, exit codes).
- Delete: `apps/api/scripts/api-cli.sh`, `apps/api/src/db/reset-hard.ts`.
- Edit: `apps/api/package.json` (remove `cli`, `db:tunnel`, `db:reset:hard`), `apps/api/README.md:319+` (Operator CLI → pointer), `CLAUDE.md` (monorepo table row + API Database Scripts block) + `.github/copilot-instructions.md` mirror, `docs/CLI_DEPLOYED_ENV_ACCESS.discovery.md` (retire-map correction).

**Steps**

1. **Tests (doc-sync).** A repo-wide grep pins zero remaining references to `api-cli.sh` / `reset-hard` / the removed scripts (checked in the smoke doc; no unit test needed — deletions break nothing compiled). Run existing suites; green.
2. **Write the docs; execute the smoke against app-dev (with the user); then apply the deletions.**
3. Lint + type-check across affected packages; full `turbo run test:unit`.

**Done when:** smoke signed off; the bash and its wrappers are gone; every doc surface updated; PR ready.

**Risk:** deleting live tooling — strictly gated on the smoke sign-off in the same slice; revert restores the bash intact.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | cli-env put*/decryption; scaffold + catalog + vars reads | ≈15 new cases; both packages green |
| 2 | vars set/apply/template with guards+audit | vars surface complete (≈11 devops vars cases) |
| 3 | db group + ecs seed + reset + bin/exit codes | ≈35 total green; `portalops --help` runs |
| 4 | README/COMMANDS/quickstarts + smoke + retire bash/scripts + doc-sync | smoke signed off; zero stale references |

## Cross-slice notes

- **Guard/audit seams are mocked in unit tests** (cli-env is already tested) — devops tests assert *calls with the right class*, not re-testing guard logic.
- **`db:seed:ci` must survive** every edit to `apps/api/package.json` — the ECS task runs it inside the container; slice 3's `ecs.ts` and slice 4's retirement both depend on it.
- **Banner on stderr / payload on stdout** is a slice-1 `output.ts` invariant every later command inherits — pinned once in bin tests.
- **Smoke before deletion** (slice 4 internal ordering) — the same-PR retirement only applies after the live walkthrough passes, mirroring the #194 pattern.
- **Doc-sync inventory** (per `CLAUDE.md` → Keeping Documentation in Sync): `apps/api/README.md`, `CLAUDE.md` (two sections), copilot mirror, #194's discovery table — all in slice 4, same PR.

## Next step

Implementation begins on `feat/devops-cli` — slice 1 first, tests-red-then-green, one commit per slice; the slice-4 smoke is walked together against app-dev before the deletions land.

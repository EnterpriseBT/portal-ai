# Fresh-environment site-config provisioning — Plan

**TDD-sequenced implementation of the slices-1+2 scope: a tested preflight that names the exact `portalops` remediation per env, a `workflow_run` ordering flip so the site deploy waits for `Deploy Dev`, and a create-if-absent contact seed on the non-prod pipeline.**

Spec: `docs/SITE_CONFIG_PROVISIONING.spec.md`. Discovery: `docs/SITE_CONFIG_PROVISIONING.discovery.md`. Issue: #319. Follows the marketing-site work (#311) and the turbo-env fix (#318), both on `main`.

Three slices, each behind a green suite and each leaving the repo compilable + workflows valid. They land as **commits on `fix/site-config-provisioning` / PR #323** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from the site package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/site && npm run test:unit
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — the only unit-testable logic (the preflight) lands first and carries **all** the tests; the two workflow-only slices follow and are smoke-gated:

- **Slice 1** — the preflight script (pure `evaluate` + runner) + its 7 unit tests + wiring into `deploy-static-site.yml`, with **both callers** passing the new `portalops-env` input in the same commit so every `workflow_call` stays valid. Self-contained; shippable alone; it is what makes slices 2–3 observable.
- **Slice 2** — the `workflow_run` ordering flip (pure trigger change). No unit seam; smoke-gated. Depends on nothing from slice 3.
- **Slice 3** — the create-if-absent contact seed in `deploy-dev.yml`. No unit seam; smoke-gated. Ordered last so the slice-1 preflight can validate the seeded result end-to-end.

No DB migration, no API code, no contract change (spec → Migration/Seed).

---

## Slice 1 — Preflight script + wiring

The tested seam. A pure `evaluate()` classifies a site-config response into pass / actionable-remediation; a thin runner fetches with bounded retry and fails the deploy with a GitHub `::error::`. Wired before `Build site`.

**Files**

- New: `apps/site/scripts/preflight-site-config.mjs` — `export function evaluate({ status, body, isProd, portalopsEnv })` + a default runner reading `SITE_CONFIG_URL` / `PORTALOPS_ENV` / `IS_PROD`.
- New: `apps/site/scripts/__tests__/preflight-site-config.test.ts` — the `evaluate` cases.
- Edit: `.github/workflows/deploy-static-site.yml` — add required `workflow_call` input `portalops-env`; add the **"Preflight site-config"** step immediately before `Build site` (`IS_PROD` derived from `inputs.environment == 'prod'`).
- Edit: `.github/workflows/deploy-site-dev.yml` — pass `portalops-env: app-dev`.
- Edit: `.github/workflows/deploy-site-prod.yml` — pass `portalops-env: prod`.

**Steps**

1. **Tests (spec cases 1–7).** In `preflight-site-config.test.ts`, drive `evaluate` (no network): 200+tiers → `ok`; 200+empty → `tier apply --env app-dev`; 503 `CONTACT_UNRESOLVED` → both `vars set SUPPORT_EMAIL`/`SALES_EMAIL` + `--env app-dev`; same with `isProd` → `--confirm-prod`; 503 `PRICE_UNRESOLVED` → names the slug; `401`/`502` → terminal, names status; unparseable body on 200 → safe `reason`, no throw. Run; fail.
2. **Implement** `evaluate` + the runner (bounded retry only for the transport/`401`/`5xx` class). Add the workflow input + preflight step; make both callers pass `portalops-env`. Green.
3. Lint + type-check (`cd apps/site`).

**Done when:** the 7 `evaluate` cases pass via `npm run test:unit`; all three workflows parse with the new input threaded; nothing publishes differently for a healthy endpoint.

**Risk:** the new required input must be added to `deploy-static-site.yml` and passed by **both** callers in this same commit, or a `workflow_call` breaks — hence they're one slice.

---

## Slice 2 — Deploy-ordering flip

Make the push-driven dev site deploy wait for `Deploy Dev` so the build never hits a not-yet-rolled API (the `401` race).

**Files**

- Edit: `.github/workflows/deploy-site-dev.yml` — replace the `push:{branches:[main],paths:[…]}` trigger with `workflow_run:{workflows:["Deploy Dev"],types:[completed],branches:[main]}`; gate the job `if: github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success'`. Keep `repository_dispatch`, `schedule`, `workflow_dispatch`.

**Steps**

1. **Tests.** None at the unit layer — this is a trigger/`if` change with no importable seam (spec: "not unit-tested; contract is the deploy behavior"). The gate is the smoke walk (§ added by `/smoke`).
2. **Implement** the trigger swap + job `if`. Confirm `actionlint`/YAML validity locally if available; otherwise a dry `gh workflow view` post-push.
3. Lint + type-check (no-op for the site package; confirm nothing else regressed).

**Done when:** `deploy-site-dev.yml` no longer triggers directly on push; a successful `Deploy Dev` is what launches the push-path site deploy; manual/dispatch/nightly paths still work.

**Risk:** `workflow_run` drops the `paths` filter → every `Deploy Dev` success rebuilds the site (recorded trade, spec → Risks). Watch for a rebuild loop with `repository_dispatch` — there isn't one (dispatch is fired by config changes, not by the site deploy).

---

## Slice 3 — Contact seed (create-if-absent, non-prod)

Seed the two contact SSM params on the dev pipeline so a fresh env's endpoint returns 200 without a manual `vars set`, never overwriting an operator value.

**Files**

- Edit: `.github/workflows/deploy-dev.yml` — add the **"Seed contact config (create-if-absent)"** step in `deploy-infra` (after AWS creds; near the DB seed), writing `/portalai/dev/support-email → support@portalsai.io` and `/portalai/dev/sales-email → sales@portalsai.io` via `aws ssm put-parameter` **without `--overwrite`**, swallowing `ParameterAlreadyExists`.

**Steps**

1. **Tests.** None at the unit layer — pure `aws` CLI (spec: smoke-gated). The create-if-absent + no-overwrite behavior is asserted in the smoke walk (fresh-env: params created; re-run: operator value preserved).
2. **Implement** the step. Verify the `|| echo` swallows the already-exists error and that `--overwrite` is **absent** (review gate — the overwrite hazard from spec → Risks).
3. Lint + type-check (no-op for site; confirm nothing else regressed).

**Done when:** a dev deploy creates the two params when absent and leaves an existing operator value untouched; the step lives only in `deploy-dev.yml` (non-prod by placement).

**Risk:** an accidental `--overwrite` would clobber operator contacts — guard in review. Fail-mode is fail-open (a seed-step error still proceeds to the preflight, which fail-closes safely).

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `preflight-site-config.mjs` + tests + wiring + `portalops-env` on 3 workflows | `npm run test:unit` (7 cases) green; workflows parse |
| 2 | `workflow_run` ordering in `deploy-site-dev.yml` | smoke: push-path deploy waits for `Deploy Dev` |
| 3 | create-if-absent contact seed in `deploy-dev.yml` | smoke: fresh-env params created; re-run preserves operator value |

## Cross-slice notes

- **Only slice 1 has a unit seam.** Slices 2–3 are workflow-only; their contract is the deploy behavior, gated by the smoke walk `/smoke 319` scaffolds — this is a conscious, spec-recorded choice, not missing coverage.
- **Doc-sync (same PR).** `/smoke 319` adds a fresh-env provisioning section to `docs/MARKETING_SITE.smoke.md`. Also document the **deferred manual `tier apply`** (slice 3 of the discovery) so operators know paid tiers need it on a fresh env — a short note in `apps/site/README.md` or the smoke doc's provisioning section. Per `CLAUDE.md` → "Keeping Documentation in Sync", these land in this PR.
- **`portalops-env` mapping** is the one cross-file invariant: `dev` caller passes `app-dev`, `prod` caller passes `prod`; the CFN `environment` (`dev`/`prod`) drives `IS_PROD`. Keep the two distinct — conflating them is the bug the preflight copy would otherwise reintroduce.
- **No forward deps:** slice 1 references nothing from 2/3; 2 and 3 are mutually independent and only *benefit* from 1's preflight at runtime, not at compile/test time.

## Next step

After discovery + spec + plan are confirmed, implementation begins on `fix/site-config-provisioning` — slice 1 first, tests-first, one commit per slice, into PR #323. Then `/smoke 319` for the manual gate.

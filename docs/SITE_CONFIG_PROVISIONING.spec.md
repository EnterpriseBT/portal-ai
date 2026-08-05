# Fresh-environment site-config provisioning — Spec

Pins the contract for the slices-1+2 scope of [#319](https://github.com/EnterpriseBT/portal-ai/issues/319): a **deploy preflight** that turns opaque site-config failures into actionable ones, a **deploy-ordering** change that removes the site-vs-API race, and a **create-if-absent contact seed** on the non-prod pipeline. Builds on `docs/SITE_CONFIG_PROVISIONING.discovery.md`. **Infra/CI only — no DB schema, no API code, no contract change.**

## Key decisions (confirmed)

1. **Fail policy split by env.** Non-prod (`Deploy Dev`) seeds placeholder contacts → green by default. **Prod stays fail-closed** — no seed; the preflight names the remediation. `site-config.service.ts`'s 503 is unchanged and is the prod safety net.
2. **Scope = slices 1 + 2.** Slice 3 (auto `tier apply`) is **deferred** — it depends on per-env Stripe price provisioning (`plus_monthly`/`pro_monthly`), tracked adjacent to #83. A fresh env deploys Standard-only until an operator runs `tier apply`; the preflight names that command.
3. **Placeholder values = `support@portalsai.io` / `sales@portalsai.io`**, create-if-absent, **never overwriting** an operator-set value.
4. **Canonical SSM paths** (verified live): `/portalai/dev/support-email`, `/portalai/dev/sales-email`. `--env app-dev`'s AWS `envName` is `dev` (`cli-env/registry.ts:28,157`), so the CI seed and `portalops vars set` write the identical path the API reads (`BUSINESS_CONFIG_SSM_PREFIX=/portalai/${Environment}`, `backend.yml:514`).
5. **IAM.** The dev deploy role `github-cicd-deploy-dev` (trust `repo:EnterpriseBT/portal-ai:ref:refs/heads/main*`) has `AdministratorAccess` → `ssm:PutParameter` is available; no IAM change needed. If that role is ever scoped down, its policy must include `ssm:PutParameter` on `arn:aws:ssm:*:*:parameter/portalai/dev/*`.

## Scope

### In scope
- A tested preflight script + its wiring into `deploy-static-site.yml`.
- Deploy-ordering: the push-driven site deploy waits for `Deploy Dev`.
- A create-if-absent contact-seed step in `deploy-dev.yml` (non-prod).

### Out of scope
- Auto `tier apply` / Stripe-price provisioning (slice 3, deferred).
- Any change to `site-config.service.ts`, `business-config.service.ts`, the site-config contract, or `verify-pages.mjs`' strictness (0 cards stays a hard fail).
- Prod contact provisioning (deliberately fail-closed).

## Surface

### `apps/site/scripts/preflight-site-config.mjs` (new)

A build-time preflight, sibling to `verify-pages.mjs`. Two exports:

- `export function evaluate({ status, body, isProd, portalopsEnv }) → { ok: boolean, reason?: string, remediation?: string }` — **pure**, the tested seam:
  - `status === 200` && `body.payload.tiers.length > 0` → `{ ok: true }`.
  - `status === 200` && `tiers.length === 0` → `{ ok:false, reason:"no public tiers", remediation: "portalops tier apply --env <portalopsEnv> --yes" + (isProd ? " --confirm-prod" : "") }`.
  - `status === 503` && `body.code === "SITE_CONFIG_CONTACT_UNRESOLVED"` → `{ ok:false, reason, remediation: two `portalops vars set SUPPORT_EMAIL … / SALES_EMAIL … --env <portalopsEnv> --yes` lines (+` --confirm-prod` when `isProd`) }`.
  - `status === 503` && `body.code === "SITE_CONFIG_PRICE_UNRESOLVED"` → `{ ok:false, reason naming the tier, remediation pointing at the env's Stripe price for that slug }`.
  - anything else (`401`, other `5xx`, transport, unparseable body) → `{ ok:false, reason:"endpoint returned <status>" }` (terminal).
- default runner: reads `SITE_CONFIG_URL`, `PORTALOPS_ENV`, `IS_PROD` from env; `fetch`es with **bounded retry** (`RETRIES=5`, ~10s apart) only for the transport/`401`/`5xx` class (an API mid-roll); on a terminal non-ok, `console.error` a GitHub `::error::` line carrying `reason` + `remediation` and `process.exit(1)`; on ok, print a one-line pass and exit 0.

### `.github/workflows/deploy-static-site.yml` (edit)

- Add one `workflow_call` input: `portalops-env` (required, string) — the `portalops --env` name for remediation copy (`app-dev` / `prod`). `isProd` is derived from `inputs.environment == 'prod'`.
- New step **"Preflight site-config"**, immediately **before** `Build site`:
  ```
  env: { SITE_CONFIG_URL: ${{ inputs.site-config-url }}, PORTALOPS_ENV: ${{ inputs.portalops-env }}, IS_PROD: ${{ inputs.environment == 'prod' }} }
  run: node apps/site/scripts/preflight-site-config.mjs
  ```
  A failed preflight fails the job before the build burns time, with an actionable message.

### `.github/workflows/deploy-site-dev.yml` (edit) — ordering

- Replace the `push: { branches:[main], paths:[…] }` trigger with:
  ```
  workflow_run: { workflows: ["Deploy Dev"], types: [completed], branches: [main] }
  ```
  Keep `repository_dispatch` (config change), `schedule` (nightly), `workflow_dispatch` (manual).
- Gate the job: `if: ${{ github.event_name != 'workflow_run' || github.event.workflow_run.conclusion == 'success' }}` — a failed/cancelled `Deploy Dev` does not publish.
- Pass `portalops-env: app-dev` to the reusable workflow.
- **Trade recorded:** `workflow_run` can't filter paths, so every successful `Deploy Dev` triggers a site rebuild (even non-site changes). Acceptable — the site snapshot *should* refresh when the backend/config changes, and the build is ~2 min.

### `.github/workflows/deploy-site-prod.yml` (edit)

- Pass `portalops-env: prod` to the reusable workflow. No seed, no ordering change (prod has no `Deploy Dev`); fail-closed via the preflight is the intended behavior.

### `.github/workflows/deploy-dev.yml` (edit) — contact seed

- New step **"Seed contact config (create-if-absent)"** in `deploy-infra`, after AWS creds are configured (co-located with the DB seed step). For each leaf `support-email → support@portalsai.io`, `sales-email → sales@portalsai.io`:
  ```
  aws ssm put-parameter --name /portalai/dev/<leaf> --type String --value <addr> \
    2>/dev/null && echo "seeded <leaf>" || echo "<leaf> already set — leaving operator value"
  ```
  **No `--overwrite`** — `put-parameter` without it errors on an existing param (`ParameterAlreadyExists`), which the `|| echo` swallows. Create-if-absent, idempotent, never clobbers a `portalops vars set` value. Present **only** in the dev pipeline → non-prod-only by placement.

## Migration / Seed

No DB schema change → **no Drizzle migration**. The only "seed" is the SSM contact step above (infra, not `SeedService`); `seed.service.ts` is untouched.

## TDD test plan

### `apps/site/scripts/__tests__/preflight-site-config.test.ts` (new)

Drives the pure `evaluate` export (no network). Cases:

1. `200` + `tiers:[{…}]` → `ok:true`.
2. `200` + `tiers:[]` → `ok:false`, `remediation` contains `tier apply --env app-dev`.
3. `503` + `code:"SITE_CONFIG_CONTACT_UNRESOLVED"` → `ok:false`, `remediation` contains `vars set SUPPORT_EMAIL` **and** `SALES_EMAIL` and `--env app-dev`.
4. same as 3 with `isProd:true` → `remediation` contains `--confirm-prod`.
5. `503` + `code:"SITE_CONFIG_PRICE_UNRESOLVED"` → `ok:false`, `reason` names the tier slug.
6. `401` (and a `502`) → `ok:false`, `reason` names the status (terminal class).
7. unparseable/empty `body` on a `200` → `ok:false`, safe `reason` (no throw).

Run via `npm run test:unit` in `apps/site`. **Totals ≈ 7 cases.**

The seed step, the `workflow_run` ordering, and the preflight wiring are **not** unit-tested (pure `aws` CLI / YAML triggers); their contract is the deploy behavior, asserted in the smoke walk (fresh-env deploy + re-deploy), consistent with `jest.config`'s "components' contract is the emitted artifact" note.

## Acceptance criteria

- A fresh **dev** deploy creates `/portalai/dev/support-email` + `/portalai/dev/sales-email` when absent; re-running does **not** overwrite an operator-set value.
- The **push-driven** dev site deploy runs only after `Deploy Dev` succeeds — no `401`-from-not-yet-deployed-API failure.
- Preflight **fails** a deploy on `SITE_CONFIG_CONTACT_UNRESOLVED` or empty `tiers`, printing the exact `portalops vars set` / `tier apply` command for that env; **passes** a healthy endpoint.
- A **prod** deploy performs **no** contact seeding; with contacts unset it fails the preflight with a `--confirm-prod` remediation (fail-closed preserved).
- No change to the site-config API response or to the published HTML for a healthy env.

## Risks & rollback

- **Ordering trade** — `workflow_run` drops the path filter → more frequent site rebuilds. Detected as extra green runs. Rollback: restore the `push`/`paths` trigger.
- **Overwrite hazard** — the seed must never pass `--overwrite`; a test/review gate on the step's flags prevents clobbering operator contacts. **Fail-mode: fail-open** — if the seed step errors, the deploy proceeds to the preflight, which fail-closes safely.
- **Retry masking** — the preflight's bounded retry can add ≤~1 min when the API is mid-roll; capped by `RETRIES`, cannot hang.
- **prod placeholder leak** — structurally prevented: the seed lives only in `deploy-dev.yml`.

## Files touched

- `apps/site/scripts/preflight-site-config.mjs` (new)
- `apps/site/scripts/__tests__/preflight-site-config.test.ts` (new)
- `.github/workflows/deploy-static-site.yml` (edit — input + preflight step)
- `.github/workflows/deploy-site-dev.yml` (edit — `workflow_run` ordering + `portalops-env`)
- `.github/workflows/deploy-site-prod.yml` (edit — `portalops-env`)
- `.github/workflows/deploy-dev.yml` (edit — contact seed step)
- `docs/MARKETING_SITE.smoke.md` (edit — add fresh-env provisioning checks; new smoke section for #319)

## Next step

`docs/SITE_CONFIG_PROVISIONING.plan.md` slices this into testable commits: **(1)** the preflight script + tests + its wiring into `deploy-static-site.yml` and the two callers' `portalops-env` inputs (self-contained, no new perms — shippable alone); **(2)** the `workflow_run` ordering flip; **(3)** the create-if-absent contact seed in `deploy-dev.yml`. Slice 1 carries all the unit tests; 2 and 3 are workflow-only, gated by the smoke walk.

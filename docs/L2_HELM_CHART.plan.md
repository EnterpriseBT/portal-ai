# L2 Helm chart (installable, full-residency package) — Plan

**Implements the #566 chart contract TDD-sequenced: the readiness endpoint and the runtime-config web image (pure, jest-tested) land first, then the chart is built up template-by-template behind `helm lint`/`helm template` checks.**

Spec: `docs/L2_HELM_CHART.spec.md`. Discovery: `docs/L2_HELM_CHART.discovery.md`. Issue: #566 (epic #569). Sibling: #607 (frontend OIDC client — consumes slice 2's `config.js`). Builds on #567 (S3 seams, PR #606) for the MinIO path and #577 (config-driven validator) for the `oidc:` contract.

6 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/566-l2-helm-chart`** — one feature, one PR (per `CLAUDE.md` → "Phase = commit, not PR").

Run tests from each package (never invoke jest directly — `feedback_use_npm_test_scripts`):

```bash
cd apps/api && npm run test:unit
cd packages/core && npm run test:unit
```

Chart slices are gated by `helm lint` + `helm template` (a new CI step / `scripts/check-helm.mjs`), not jest. Each slice: (1) write failing tests; (2) smallest change to green; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

Sequencing rationale — **S1** (readiness endpoint) is pure API code the chart's probes will reference, no chart needed. **S2** (web image + `config.js`) is the other pure code change and produces the artifact the chart deploys; its `config.js` is what #607 later consumes. **S3** stands up the chart skeleton (both workloads + probes from S1 + config from S2) — the first `helm install`-able unit. **S4** adds bundled data deps + external toggles. **S5** adds migrate/seed hooks (needs the chart + image command contract from S3). **S6** adds optional ingress + the Keycloak bundled issuer + docs. Nothing references a later slice.

---

## Slice 1 — `/api/health/ready` readiness endpoint

The one API code change: a DB+Redis readiness probe target, split from the deps-free liveness `/api/health`.

**Files**

- Edit: `packages/core/src/contracts/health.contract.ts` — add `HealthReadyResponseSchema` + `HealthReadyResponse`.
- Edit: `apps/api/src/constants/api-codes.constants.ts` — add `HEALTH_NOT_READY = "HEALTH_NOT_READY"`.
- Edit: `apps/api/src/routes/health.router.ts` — add `GET /ready` (DB `select 1` + `getRedisClient().ping()`, both timeout-guarded; 200/503; `@openapi`).
- Edit: `apps/api/src/config/swagger.config.ts` — register `HealthReadyResponse` component.
- Edit: `apps/api/src/__tests__/routes/health.router.test.ts` (new if absent) and `packages/core/src/contracts/__tests__/health.contract.test.ts`.

**Steps**

1. **Tests (spec cases: API ≈5, contract ≈2).** Core: `HealthReadyResponseSchema` accepts a valid payload, rejects missing `checks`. API: `/api/health/ready` → 200 `{ready:true,checks:{db:true,redis:true}}` with both stubs resolving; → 503 when `db.execute` throws; → 503 when `ping()` rejects; body carries `checks` + `ApiCode.HEALTH_NOT_READY`; liveness `/api/health` unchanged. Run; fail.
2. **Implement** the contract, the enum member, the handler (inject/stub `db`+`getRedisClient` at the test seam), the swagger component. Green.
3. Lint + type-check (`packages/core` then `apps/api`).

**Done when:** both suites green; `/api/health/ready` returns 503 with the failing dep named; liveness untouched.

**Risk:** the timeout guard must not leak a pending handle in tests — use `Promise.race` with a cleared timer, or the fake timers already in the health test.

---

## Slice 2 — Web image + runtime `config.js`

A standalone `nginx-unprivileged` web image whose entrypoint renders `config.js` from env; the SPA loads it (consumption is #607).

**Files**

- New: `apps/web/Dockerfile` (build → `nginx-unprivileged` runtime, SPA fallback), `apps/web/nginx.conf`, `apps/web/scripts/render-config.mjs` (pure `renderConfigJs(env) → string` + a thin CLI the entrypoint calls).
- New: `apps/web/src/__tests__/render-config.test.ts` (jest, via `apps/web` test runner).
- Edit: `apps/web/index.html` — `<script src="/config.js"></script>` before the bundle.
- Edit: `.github/workflows/deploy-dev.yml` + `deploy-prod.yml` — build+push the web image (mirror the API step); `infra/cloudformation/backend.yml` — add a web ECR repo.

**Steps**

1. **Tests (spec: config.js contract).** `renderConfigJs`: given `{AUTH_PROVIDER,OIDC_ISSUER,OIDC_CLIENT_ID,OIDC_AUDIENCE,DEPLOY_MODE}` emits `window.__RUNTIME_CONFIG__ = {...}` with those values; unset → falls back to `VITE_*`-equivalent defaults / empty; output is valid assignable JS (parse-check). Run; fail.
2. **Implement** `render-config.mjs`, the Dockerfile + nginx.conf + entrypoint invocation, the `index.html` script tag, the pipeline build + ECR repo. Green.
3. Lint + type-check.

**Done when:** `renderConfigJs` test green; `docker build -f apps/web/Dockerfile .` produces an image that serves the SPA and writes `config.js` from env (verified in smoke, not CI). SaaS build behavior unchanged (SPA still reads `VITE_*` until #607).

**Risk:** the ECR-repo + pipeline changes aren't exercised until deploy (both epics → main → app-dev, per the requester) — an intentional deferral, flagged, not a gap. Keep `config.js` non-secret only.

---

## Slice 3 — Chart skeleton (api + web, one release)

The first `helm install`-able unit: both Deployments/Services, config/secret, probes from S1, image refs from S2.

**Files**

- New: `deploy/helm/portalai/{Chart.yaml,values.yaml,values.schema.json,templates/_helpers.tpl,templates/api-deployment.yaml,templates/api-service.yaml,templates/web-deployment.yaml,templates/web-service.yaml,templates/configmap.yaml,templates/secret.yaml,templates/NOTES.txt}`.
- New: `scripts/check-helm.mjs`; edit `.github/workflows/static-checks.yml` — run `helm lint` + `helm template`.

**Steps**

1. **Tests (spec: 3 helm-render assertions, subset).** `helm lint deploy/helm/portalai` clean; `helm template` with defaults renders the api Deployment with **both** probes (`/api/health`, `/api/health/ready`) and `securityContext.runAsNonRoot: true`, and the web Deployment referencing `image.web`. Run; fail (no chart yet).
2. **Implement** the skeleton templates + values + schema + the CI script. Green.
3. Lint + type-check (the mjs script) + `helm lint`.

**Done when:** `helm template` renders api+web with probes/securityContext/env from ConfigMap+Secret; CI step green. (Data-dep URLs still reference `*.external` placeholders — bundled deps come in S4.)

**Risk:** low — `helm` is on the devcontainer PATH (added to the root `Dockerfile` on this branch) and installed in the CI job, so `helm lint`/`helm template` run both locally and in CI. The check script still degrades with a clear message if the binary is somehow absent.

---

## Slice 4 — Bundled data subcharts + external toggles

Bitnami postgresql (PostGIS override) / redis (PVC) / minio as dependencies, each disable-able to an external endpoint.

**Files**

- Edit: `deploy/helm/portalai/Chart.yaml` (+ `Chart.lock`) — `postgresql`/`redis`/`minio` deps with `condition:`.
- Edit: `deploy/helm/portalai/values.yaml` + `values.schema.json` — `postgresql/redis/minio` blocks (PostGIS image, Redis PVC default, `external` sub-blocks).
- Edit: `deploy/helm/portalai/templates/_helpers.tpl` — compose `DATABASE_URL`/`REDIS_URL`/`UPLOAD_S3_*` from bundled service names when enabled, else `*.external`.

**Steps**

1. **Tests.** `helm template` with **defaults** → env references the bundled service DNS names + a PostGIS image + Redis persistence enabled; with `postgresql.enabled=false redis.enabled=false minio.enabled=false` + external values → env references the external endpoints and no subchart objects render. Run; fail.
2. **Implement** deps + values + the `_helpers.tpl` branch; `helm dependency build`. Green.
3. `helm lint` + the CI script.

**Done when:** both render paths pass; Redis PVC on by default; `DB_MASTER_SECRET_ARN` never set.

**Risk:** Bitnami PostGIS override — confirm the `imresamu/postgis` image satisfies the subchart's expected init; if the subchart hard-codes the postgres image entrypoint, may need `image.repository`+`image.tag` override plus `postgresqlExtendedConf`/init to `CREATE EXTENSION`. Documented as a render+smoke check.

---

## Slice 5 — Migrate / seed hook Jobs

Run the existing `db:migrate:ci`/`db:seed:ci` as Helm lifecycle hooks on the API image.

**Files**

- New: `deploy/helm/portalai/templates/migrate-job.yaml` (`hook: pre-install,pre-upgrade`), `templates/seed-job.yaml` (`hook: post-install`).
- Edit: `values.yaml` + `values.schema.json` — `migrate.enabled`/`seed.enabled`.

**Steps**

1. **Tests.** `helm template` renders migrate-job with `helm.sh/hook: pre-install,pre-upgrade`, `hook-delete-policy`, and command `["node","dist/scripts/db-migrate.js"]` on `image.api`; seed-job with `post-install` and `["node","dist/db/seed.js"]`; both suppressed when `*.enabled=false`. Run; fail.
2. **Implement** the two hook templates + values. Green.
3. `helm lint` + CI script.

**Done when:** hooks render with correct annotations/commands/weights; toggles work. (Actual migrate execution is proven in the EKS smoke.)

**Risk:** hook ordering — migrate must complete before api pods start (pre-install/upgrade guarantees this); seed post-install only (idempotent global seeds).

---

## Slice 6 — Optional Ingress + Keycloak bundled issuer + docs

Values-gated ingress, the optional bundled fallback issuer, and the chart README (doc-sync).

**Files**

- New: `deploy/helm/portalai/templates/ingress.yaml`, `deploy/helm/portalai/README.md`.
- Edit: `Chart.yaml` (+ lock) — `keycloak` (Bitnami) dep `condition: bundledIssuer.enabled`; `values.yaml`+schema — `ingress`, `bundledIssuer` blocks.
- Edit (doc-sync): root `README.md` + `docs` pointer noting the chart exists and how to install; confirm `CLAUDE.md` "Environment URLs"/deploy narrative still accurate.

**Steps**

1. **Tests.** `helm template` with `ingress.enabled=true` renders an Ingress routing `/api`→api-service, `/`→web-service, with TLS block when configured; default (`false`) renders none. `bundledIssuer.enabled=true` renders the Keycloak subchart; default renders none. Run; fail.
2. **Implement** ingress template, keycloak dep, README, root-README note. Green.
3. `helm lint` + CI script; `npm run lint`/`type-check` (repo-wide) green.

**Done when:** ingress + issuer render under their toggles; README documents values + the PostGIS `CREATE EXTENSION` prereq + cert-manager TLS; root docs reference the chart.

**Risk:** none beyond footprint — Keycloak is heavy but off by default.

---

## Sequence summary

| Slice | Lands | Gating check |
|---|---|---|
| 1 | `/api/health/ready` + contract + ApiCode | `apps/api` + `packages/core` `test:unit` |
| 2 | Web image + `config.js` + pipeline build | `apps/web` `test:unit` (`renderConfigJs`) + docker build (smoke) |
| 3 | Chart skeleton (api+web, probes, config) | `helm lint`/`template` CI |
| 4 | Bundled PostGIS/Redis(PVC)/MinIO + external toggles | `helm template` (default + external) |
| 5 | Migrate/seed hook Jobs | `helm template` (hook annotations/commands) |
| 6 | Ingress + Keycloak issuer + docs | `helm template` (gated) + doc-sync |

## Cross-slice notes

- **`config.js` is generated (S2) but not consumed for auth until #607** — the SaaS `VITE_*` path is untouched across all six slices; zero behavior change to today's app.
- **Deploy-time pieces (web ECR, pipeline build, actual `helm install`) aren't CI-exercised** — they're validated when both epics merge to `main` → app-dev with the mock-customer install (per the requester). Slices land green on chart-render + jest evidence; the EKS green install is the smoke gate.
- **Doc-sync (S6):** chart `README.md` + a root-README/`docs` pointer that the Helm chart is the install artifact. Per `CLAUDE.md` → "Keeping Documentation in Sync," this lands in the same PR.
- **`helm` binary:** added to the devcontainer root `Dockerfile` on this branch (per `feedback_devcontainer_tools_in_dockerfile` — Dockerfile only, never an ad-hoc install into the running container), so `helm lint`/`template` work locally; the CI step also installs helm. Takes effect on the next devcontainer rebuild.
- **`Chart.lock`** is committed with the Bitnami dep versions (S4/S6) so `helm dependency build` is reproducible and a missing repo fails loudly.

## Next step

Once discovery + spec + plan are reviewed and confirmed, implementation starts on `feat/566-l2-helm-chart` — Slice 1 (readiness endpoint), tests-first, one commit per slice, the draft PR growing commit-by-commit.

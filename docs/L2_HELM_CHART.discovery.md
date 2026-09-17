# L2 Helm chart (installable, full-residency package) — Discovery

**Issue:** [EnterpriseBT/portal-ai#566](https://github.com/EnterpriseBT/portal-ai/issues/566)

**Why this exists.** Enterprise installs ship through cloud marketplaces, which need a self-contained, installable unit. Today there is **no production install artifact**: the app deploys to AWS via CloudFormation (`infra/cloudformation/`) driven by `.github/workflows/deploy-dev.yml`/`deploy-prod.yml` — ECS Fargate for the API, S3+CloudFront for the web SPA. `docker-compose.yml` is dev-only and doesn't run `api`/`web`. This ticket delivers the Helm chart (the "L2 package") that the AWS Marketplace listing (#568) wraps and, per the epic's whole purpose, that a **client-owned residency stack** deploys — one `helm install` standing up the entire application inside the customer's own cluster with **no dependency on our infrastructure or identity provider**. It is the single artifact both SaaS and self-hosted installs deploy from.

**Scope confirmed with the requester (2026-09-16).** The chart must deliver a **full client-owned residency install**, not a SaaS-config-only one. That pulls the residency *identity* path into scope: the prebuilt web image must authenticate against the **customer's own OIDC** (or a bundled fallback issuer), configured at **runtime**, not baked at build. #577 (Enterprise SSO) already made the backend validator config-driven + on-first-token provisioning, and **explicitly handed the "Helm chart / bundled-issuer packaging" and "the config contract the chart must satisfy" to #566/#569** — but #577 was *backend + provisioning only*. The frontend is still Auth0-SDK-hardwired (below). Closing that gap is the substantive new design work here.

**PRD note.** The ticket-SKILL PRD dimensions (actors/roles, in-app surfaces, standard-vs-bespoke UX) are mostly **N/A** — the actor is the platform operator running `helm install`; there is no new in-app surface. The genuine forks are engineering decisions, surfaced below with leans.

## The current shape

### Containerization & image build

| Piece | Location | Note |
|---|---|---|
| API Dockerfile | `apps/api/Dockerfile:1-8`, 3 stages `node:22-alpine` | `EXPOSE 3001`; `HEALTHCHECK` curls `/api/health`; `CMD node --max-old-space-size=3200 dist/index.js`. Copies `dist`, `drizzle/`, built `@portalai/core`+`@portalai/spreadsheet-parsing`. |
| Web app | `apps/web/vite.config.ts`, `apps/web/dist` | Vite SPA. **No web Dockerfile, no nginx.** Ships static → S3+CloudFront (`infra/cloudformation/frontend.yml`). Build-time `VITE_*` at `deploy-dev.yml:315-326`. |
| **Web auth (the residency crux)** | `apps/web/src/providers/Application.provider.tsx:41-50` | **Hard-wired to `@auth0/auth0-react`** (`Auth0Provider`/`useAuth0`) with build-time `VITE_AUTH0_DOMAIN/CLIENT_ID/AUDIENCE`. `useAuth0` consumed in `utils/api.util.ts`, `api/auth.api.ts`, `api/sse.api.ts`, layouts. Cannot point at a customer/bundled OIDC without change. |
| Image build/push | `deploy-dev.yml:399-415`, `deploy-prod.yml:370-390` | `docker/build-push-action@v6`, `linux/arm64`, tag `<ecr-uri>:dev-<sha>`+`:latest`. |
| Runtime connector config (#580) | `apps/api/src/routes/connector-config.router.ts` | `GET /api/connector-config` serves non-secret runtime config — the precedent for build→runtime config a prebuilt image relies on. |

**Tree-state note (this epic branch).** On `epic/enterprise-deployment` the API Dockerfile has no non-root `USER`/`apk upgrade`, `drizzle-kit` is still a runtime dep (`apps/api/package.json:57`), the deploy workflows have no Trivy/cosign gate, and the **#567 S3 seams aren't merged** (PR #606, same epic). CLAUDE.md describes these as done because they live on the *security* epic (#571/#573) or an unmerged sibling. Bearing on this ticket in "Cross-epic sequencing" below.

### Runtime config, data deps, migrate/seed, health

| Piece | Location | Note |
|---|---|---|
| Env schema | `apps/api/src/environment.ts` (265 lines) + `.env.example` + parity test | ~15 REQUIRED vars; deployed secrets today via Secrets Manager/SSM → K8s Secrets/ConfigMaps in-chart. |
| AWS escape hatch | `DB_MASTER_SECRET_ARN` (#500) | Absent ⇒ AWS SDK untouched, password from `DATABASE_URL`. Non-AWS install leaves it unset. |
| Deploy-mode + identity (#579/#577) | `apps/api/src/config/deploy-mode.ts`, `environment.ts:14-19` | `DEPLOY_MODE=saas\|residency`; residency must set `OIDC_ISSUER`+`OIDC_AUDIENCE`, no Stripe. Backend validator already config-driven. |
| Postgres+**PostGIS** | `apps/api/drizzle/0076_enable-postgis.sql` (`CREATE EXTENSION postgis`) | `imresamu/postgis:17-3.5-alpine`. Plain postgres won't migrate. |
| Redis (BullMQ) | `apps/api/src/queues/jobs.queue.ts:27-28` | `redis:7-alpine`. **Durable job store — needs a PVC.** |
| S3/MinIO | `apps/api/src/services/s3.service.ts` | MinIO needs #567 endpoint/path-style seams (PR #606). |
| Migrate/seed | `apps/api/package.json:29,33` (`db:migrate:ci`/`db:seed:ci` → `node dist/...`) | Today ECS `run-task` overrides (`deploy-dev.yml:449-495`). |
| Health | `apps/api/src/routes/health.router.ts` | `GET /api/health` → 200 liveness only (DB/Redis check commented out, lines 38-40). |

### Infra-as-code today

Only CloudFormation (`infra/cloudformation/`). No Terraform, no k8s/Helm. This ticket introduces the first Kubernetes/Helm artifacts.

## The design space

### Decision 1 — Web serving: standalone image, one Helm release *(answers requester Q2)*

The requester leans to a **standalone web image** to keep web/api decoupled, and asks whether one install can still bring up both. **Yes** — that is exactly Helm's model: build **two images** (api, web), and the chart is **one release** (`helm install portalai deploy/helm/portalai`) that stands up both Deployments+Services (plus data deps + hooks) as a single containerized deployment. Decoupled artifacts, one install command, independent scaling/rollout per workload.

**Decision: standalone web image** (`nginxinc/nginx-unprivileged` serving the built SPA), api + web as separate Deployments in one release. Building the web image (`apps/web/Dockerfile`) is a deliverable — none exists today. Rejected: folding the SPA into the API container (couples release cadence + scaling) and keeping S3+CloudFront (AWS-specific runtime dep, violates residency).

### Decision 2 — Bundled data deps vs. external

**Decision: bundle by default, disable-able per dep.** The acceptance demands a green `helm install` against bundled Postgres+PostGIS/Redis/MinIO, so bundle them (subcharts) with `postgresql.enabled`/`redis.enabled`/`minio.enabled` + external-endpoint values for production residency on managed data. **PostGIS:** override the DB image to `imresamu/postgis:17-3.5` and document the `CREATE EXTENSION` privilege prereq. **Redis needs a PVC** — it's the durable BullMQ store; an ephemeral bundled Redis silently drops enqueued jobs. Bundled deps are single-replica **evaluation-grade** (a stated downgrade); production points at external managed HA.

### Decision 3 — Migrate / seed execution

**Decision: Helm-hook Jobs.** Migrate as a `pre-install,pre-upgrade` hook Job (before new pods, mirroring ECS ordering, once — not per-replica); seed as a `post-install` hook (global seeds are idempotent). Both are `node dist/...` command overrides on the API image (not `npm run`, per the minimized-runtime contract). Deep per-install migration/backfill safety is **#581's** job (depends on this chart); #566 ships the basic hook.

### Decision 4 — Liveness vs. readiness probes *(answers requester Q3)*

The requester asks whether the two probes can be coupled. **They can share nothing but a URL, and specifically must differ on dependency-checking** — coupling *liveness* to DB/Redis is a known anti-pattern: a transient DB blip would make Kubernetes **kill and restart every pod**, turning a brief dependency hiccup into a restart storm and a deeper outage. The correct split:

- **Liveness** = the existing pure `GET /api/health` (process-alive, no deps). Never fails on a DB outage.
- **Readiness** = a new lightweight check that *does* verify DB + Redis, so a pod that can't reach its data plane is pulled from the Service until it can.

**Decision: keep them separate** — liveness on `/api/health`, add a readiness check on DB+Redis (the commented-out block in `health.router.ts` is the seed). This is a small, justified API addition; see Open Q on its exact shape.

### Decision 5 — Residency identity: runtime web config + a config-driven auth client *(the new core work; answers requester Q1)*

Full residency means the **prebuilt web image** must authenticate against the customer's own OIDC issuer (or a bundled fallback) with **no rebuild**. Two sub-problems, since the SPA is Auth0-SDK-hardwired at build time:

**5a — How the web learns its identity config at runtime.**

| | A. Entrypoint-generated `config.js` | B. Unauthenticated API bootstrap endpoint |
|---|---|---|
| Mechanism | Web image entrypoint writes `/config.js` (`window.__RUNTIME_CONFIG__ = {...}`) from container env at startup; `index.html` loads it before the app boots | SPA fetches `GET /api/public/bootstrap-config` at boot (issuer/clientId/audience/deploy-mode) |
| Startup coupling | None — web self-sufficient | Web boot depends on API availability |
| New surface | Entrypoint script only | New public endpoint |
| Decoupling (Q2 goal) | Strong — web needs nothing from api to render its login | Centralizes config on the api |

**Lean: A (entrypoint `config.js`).** Keeps the web image self-sufficient and decoupled (the requester's stated preference), no startup API dependency, standard 12-factor-SPA pattern. The chart feeds the same `oidc:` values block to both the api env (validator) and the web env (login client). The `/api` path is same-origin behind the ingress, so no API-base config is needed. (B stays a recorded alternative — it centralizes config but re-couples web startup to the api.)

**5b — Making the SPA auth client config-driven for a non-Auth0 issuer.** `Application.provider.tsx` hardwires `@auth0/auth0-react` to `VITE_AUTH0_*`. A customer OIDC issuer (or a bundled Keycloak/Dex) is standards-OIDC, not Auth0 — and the Auth0 SPA SDK is not a general OIDC client.

| | A. Keep Auth0 SDK, runtime-config its domain/clientId | B. Migrate to a generic OIDC client (`react-oidc-context`/`oidc-client-ts`), runtime-configured | C. Provider abstraction: Auth0 SDK for saas, generic OIDC for residency |
|---|---|---|
| Works vs. Auth0 (saas) | Yes | Yes (Auth0 is OIDC-compliant) | Yes |
| Works vs. Keycloak/Dex/customer OIDC | **No** (SDK assumes Auth0 endpoints/semantics) | Yes | Yes |
| Code churn | Low, but doesn't actually solve residency | Medium — replace provider + ~4-5 `useAuth0` consumers behind one hook | High — two code paths to maintain |

**Lean: B — one generic OIDC client, runtime-configured**, unifying saas (points at Auth0) and residency (points at the customer/bundled issuer) on a single path. It's a real but bounded refactor: a `useAuth`/`AuthProvider` seam replacing `useAuth0` at its ~4-5 call sites, reading issuer/clientId/audience from the runtime config (5a). **Scope call needed** (Open Q1): this frontend auth-abstraction is arguably its own concern, separable from "package as a Helm chart."

**5c — The bundled fallback issuer.** For a customer with *no* IdP, #577's confirmed plan is a bundled issuer fallback. **Lean: an optional `bundledIssuer.enabled` subchart, primary path = customer OIDC.** Provider choice (Keycloak = turnkey local accounts, heavier; Dex = light but federates upstream rather than storing users) is Open Q2.

### Decision 6 — Ingress, image sourcing, chart location

**Ingress:** optional, values-gated (`ingress.enabled`), routing `/api`→api and `/`→web, TLS via cert-manager annotations documented; default off so operators with their own gateway aren't forced. **Images:** `image.repository`/`tag`/`pullPolicy`/`imagePullSecrets` values for both, default tag = chart `appVersion` — the seam #568 repoints at the Marketplace ECR. **Location:** `deploy/helm/portalai/` + a `helm lint`/`helm template` check in Static Checks CI (full kind-cluster install-test deferred; green install proven in the EKS smoke).

## Tradeoff comparison

| | D1 web image | D2 bundle+toggle | D3 hooks | D4 split probes | D5 residency identity | D6 ingress/image/CI |
|---|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes (+ maybe a sibling ticket) | Yes |
| Blocks #568 | Yes | Yes | No | No | No | Yes (repoint registry) |
| Needs an API/web code change | web Dockerfile | No | No | small readiness endpoint | **yes — FE auth refactor** | No |

## Recommendation

1. Build a **standalone web image** (`apps/web/Dockerfile`, `nginx-unprivileged`); chart deploys api + web as one release.
2. Chart at **`deploy/helm/portalai/`**: api+web Deployments/Services, ConfigMap+Secret templated from `environment.ts`, resource requests/limits, `helm lint` CI.
3. **Bundle Postgres+PostGIS 17-3.5, Redis 7 (PVC), MinIO** as subcharts, each `*.enabled`-toggleable to external endpoints; PostGIS image override + `CREATE EXTENSION` prereq documented.
4. **Migrate = `pre-install,pre-upgrade` hook Job; seed = `post-install` hook Job**, `node dist/...` overrides.
5. **Full-residency identity:** entrypoint-generated `config.js` for runtime web config (5a-A) and an optional **bundled issuer** subchart (5c) land in #566; the **generic runtime-configured OIDC client** replacing the hardwired Auth0 SDK (5b-B) is split into sibling **#607**, which #566 depends on for live residency login.
6. **Split probes:** liveness `/api/health`, add a DB+Redis **readiness** check.
7. **Optional ingress**, values-driven **image** sourcing, no `DB_MASTER_SECRET_ARN` in-chart (password via `DATABASE_URL` Secret) → **no AWS runtime dependency**.

## Open questions

1. **[Resolved 2026-09-17] The frontend OIDC refactor (5b) is a sibling child — [#607](https://github.com/EnterpriseBT/portal-ai/issues/607)** ("Config-driven web auth: runtime OIDC login for residency"), filed as a native child of #569. #566 provides the runtime `config.js` plumbing (5a) + bundled-issuer packaging (5c) and **depends on #607** for end-to-end customer-OIDC login. #566 stays "the installable unit" and ships with SaaS Auth0 login working + the residency identity config *plumbed*; #607 makes the residency login live.
2. **Bundled issuer provider** — Keycloak (turnkey local accounts, ~heavier) vs. Dex (light, federates upstream). **Lean: Keycloak** for the no-IdP-at-all case (local accounts out of the box); revisit if footprint is a concern.
3. **Readiness endpoint shape** — extend `/api/health` with a `?ready=1`/deps mode, or add `/api/health/ready`. **Lean: a distinct `/api/health/ready`** so probe intent is unambiguous and liveness stays trivially cheap.
4. **Residency acceptance boundary for #566 itself** — if 5b is a sibling, #566's own acceptance is "green install + saas-config login (Auth0) renders a portal, and the residency identity config is *plumbed* (config.js + bundled-issuer subchart present)," with end-to-end customer-OIDC login proven once the sibling lands. **Lean: yes**, so #566 stays shippable without blocking on the FE refactor.
5. **Bundled subchart source** — Bitnami (postgresql/redis/minio) with the PostGIS override vs. hand-rolled. **Lean: Bitnami**, accepting the external chart-repo dependency.

## Cross-epic sequencing *(answers "must the security epic finish first?")*

**No — the security epic does not gate residency discovery or implementation.** The chart consumes the API image through a **stable interface** (image repo/tag, env, `node dist/...` command); the security epic's Dockerfile hardening changes the image's *internals*, not that interface. Concretely:

- **#571 (non-root USER) is forward-compatible, not blocking.** A non-root image is *better* for K8s — we author the chart's `securityContext` (`runAsNonRoot: true`, dropped caps) targeting a hardened image now; if the image isn't hardened yet the chart still runs, just less locked-down. We do **not** author the chart assuming root.
- **#573 (Trivy/cosign gate) is a pipeline concern**, orthogonal to the chart's runtime shape. Doesn't block.
- **The real coupling is #577 — and it's already resolved in our favor.** #577 (merged on the security epic) made the backend validator config-driven + provisioning, and *explicitly delegated* the chart + bundled-issuer to #566. So #566 doesn't wait on #577; it *fulfills the contract #577 defined*. Its FE piece is unfinished, which is why 5b exists.
- **New two-way touchpoint to coordinate (not block):** #566 introduces a **new web image**, which the security epic's hardening pattern (#571) and scan/sign gate (#573) should also cover. The web Dockerfile should follow #571's non-root pattern from the start, and #573's gate should learn about the web image when both reach `main`. This is coordination between the two epic branches at merge time, not a prerequisite ordering.

**Net:** proceed now; design forward-compatible with the hardened image; flag the web-image-hardening + gate-coverage as a cross-epic merge coordination item.

## Enterprise-scale considerations

- **Concurrency & correctness.** Migrate runs once as a hook Job (parallelism 1) before new pods — no cross-replica race, mirroring ECS.
- **Accuracy & auditability.** N/A — a deployment artifact holds no business record-of-truth.
- **Failure modes.** **Fail-closed** migrate (a failed hook aborts the release — never serve against an un-migrated DB). **Liveness must not check deps** (Decision 4) or a DB blip becomes a restart storm. Bundled deps non-HA by design (stated downgrade) → external managed HA via toggle.
- **Scale & unbounded growth.** Replica counts + resources are values; HPA optional. **Redis PVC mandatory** (durable job store).
- **Multi-tenancy.** A residency install is **single-tenant** (one org tree; #577's on-first-token JIT makes the first user owner). SaaS multi-tenancy is in-app and unchanged. The bundled-issuer/customer-OIDC path is per-install, so tenant isolation is the install boundary itself.
- **Contract stability.** `values.yaml` is the contract shaped so #568 (repoint `image.repository`, map a flat entitlement) and #581 (extend the migrate hook) plug in without re-plumbing; the `oidc:` block satisfies #577's config contract; env templating from `environment.ts` makes a new var a values addition.
- **Data lifecycle.** PVCs for bundled Postgres/MinIO/Redis; backup/retention is the operator's on managed data. Hooks bind to install/upgrade lifecycle.

## What this doesn't decide

- **Marketplace listing / entitlement→tier** (#568) — this only produces the chart it wraps.
- **Dockerfile hardening (#571) + supply-chain gate (#573)** — security epic; the chart consumes whatever image the pipeline produces (and its own web image should follow the same pattern — coordination, above).
- **#567 MinIO S3 seams** — same-epic sibling (PR #606); bundled-MinIO is testable once it merges.
- **GKE/AKS + native GCS/Azure storage** — on-demand later; EKS + S3-compatible only (issue out-of-scope).
- **Deep fleet-upgrade migration safety** (#581) — depends on this chart.
- **In-app SSO admin UI** — #577 out-of-scope (operator/chart-configured); a follow-up.
- **Full kind-cluster CI install test** — `helm lint`/`template` here; the green install is the EKS smoke.

## Next step

With Open Q1 resolved (5b → sibling #607), write `docs/L2_HELM_CHART.spec.md` (template inventory, `values.yaml` schema incl. the `oidc:` block, required-env mapping, hook defs, probe/resource defaults, the runtime-`config.js` contract, acceptance) and `docs/L2_HELM_CHART.plan.md`. Likely slices: (1) web image + `apps/web/Dockerfile` + pipeline build; (2) chart skeleton — api+web Deployments/Services/ConfigMap/Secret + split probes, `helm lint` CI; (3) bundled data subcharts (PostGIS/Redis-PVC/MinIO) + toggles; (4) migrate/seed hook Jobs; (5) runtime `config.js` + bundled-issuer subchart (+ the FE OIDC client, here or in the sibling); (6) optional ingress + readiness endpoint; (7) values docs + the EKS green-install smoke. Each slice `helm template`-verifiable; end-to-end green install (saas login now, customer-OIDC login once 5b lands) is the smoke gate.

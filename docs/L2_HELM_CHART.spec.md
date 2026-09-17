# L2 Helm chart (installable, full-residency package) — Spec

Pins the contract for the Helm chart that installs the whole app (api + standalone web + bundled/external data deps) as one release, plus the two code changes it needs: a readiness endpoint and a runtime-config web image. Builds on [`docs/L2_HELM_CHART.discovery.md`](./L2_HELM_CHART.discovery.md) · [issue #566](https://github.com/EnterpriseBT/portal-ai/issues/566). The frontend OIDC-client refactor is **out of scope here** — sibling [#607](https://github.com/EnterpriseBT/portal-ai/issues/607).

## Key decisions (flag for review)

1. **Standalone web image** (`nginxinc/nginx-unprivileged`) + api as two Deployments in **one Helm release**; building `apps/web/Dockerfile` is a deliverable.
2. **Bundle by default, disable-able per dep** via **Bitnami subcharts** (postgresql/redis/minio) with a **PostGIS image override**; `postgresql.enabled`/`redis.enabled`/`minio.enabled=false` + external-endpoint values for managed data. **Redis PVC mandatory** (durable BullMQ store).
3. **Migrate = `pre-install,pre-upgrade` hook Job; seed = `post-install` hook Job**, `node dist/...` overrides on the API image.
4. **Split probes:** liveness = existing `GET /api/health` (no deps); readiness = **new `GET /api/health/ready`** checking DB + Redis.
5. **Residency identity, plumbed here:** entrypoint-generated `config.js` (`window.__RUNTIME_CONFIG__`) fed to the web image; optional **Keycloak** bundled fallback issuer (`bundledIssuer.enabled`, off by default); customer OIDC is the primary path. The web *consuming* this to log in is #607.
6. **No AWS runtime dependency:** `DB_MASTER_SECRET_ARN` unset in-chart (password via `DATABASE_URL` Secret).
7. **#566 acceptance boundary:** green install + **SaaS Auth0 login renders a portal** + residency config *plumbed* (config.js present, Keycloak toggle, `oidc:` values reach api+web). End-to-end **customer-OIDC login is proven once #607 lands** (Q4 resolved).

## Scope

### In scope
- `deploy/helm/portalai/` — the chart (api+web Deployments/Services, ConfigMap+Secret, migrate/seed hook Jobs, optional Ingress, bundled data subcharts + optional Keycloak).
- `apps/web/Dockerfile` + nginx conf + entrypoint that renders `config.js` from env; web-image build+push in the deploy pipeline.
- `GET /api/health/ready` (DB+Redis) + its contract + `ApiCode` + `@openapi` + swagger component.
- `helm lint` + `helm template` CI check in Static Checks.

### Out of scope
- Frontend OIDC-client refactor / actually logging in against a non-Auth0 issuer — **#607**.
- Marketplace listing + entitlement→tier (#568); deep fleet-upgrade migration safety (#581).
- Dockerfile hardening (#571) + supply-chain gate (#573) — security epic; the chart consumes whatever image the pipeline builds (its new web image should follow the same pattern — coordination, not this ticket).
- #567 MinIO S3 seams (PR #606, same epic) — the bundled-MinIO path is testable once merged.
- GKE/AKS + native GCS/Azure storage.

## Surface

### `GET /api/health/ready` — readiness probe (the one API change)

New route in `apps/api/src/routes/health.router.ts` (alongside the existing `GET /`):

```ts
// GET /api/health/ready — readiness: DB + Redis reachable
healthRouter.get("/ready", async (_req, res, next) => { … })
```

- **DB check:** `await db.execute(sql\`select 1\`)` (`db` from `src/db/client.ts:41`; `sql` from `drizzle-orm`), wrapped so a failure is caught, with a short timeout (reuse `redis-timeout.util`/a `Promise.race` ~2s so a hung dep doesn't hang the probe).
- **Redis check:** `await getRedisClient().ping()` (`src/utils/redis.util.ts:10`), same timeout guard.
- **200** when both succeed; **503** when either fails — readiness **fail-closed** (a pod that can't reach its data plane is pulled from the Service; it is **not** restarted — that's liveness's job, which stays deps-free).
- Response contract (new, `packages/core/src/contracts/health.contract.ts`):

```ts
export const HealthReadyResponseSchema = z.object({
  ready: z.boolean(),
  checks: z.object({ db: z.boolean(), redis: z.boolean() }),
  timestamp: z.string(),
});
export type HealthReadyResponse = z.infer<typeof HealthReadyResponseSchema>;
```

- On failure use `ApiError(503, ApiCode.HEALTH_NOT_READY, …)` — **new** enum member `HEALTH_NOT_READY = "HEALTH_NOT_READY"` in `src/constants/api-codes.constants.ts` (next to `HEALTH_CHECK_FAILED:28`). The 503 body still carries `{ ready:false, checks }` so the probe/logs show which dep failed.
- `@openapi` block on the handler; register `HealthReadyResponse` under `components.schemas` in `src/config/swagger.config.ts` (via `z.toJSONSchema`), referenced by `$ref`.

### `apps/web/Dockerfile` (new) + runtime `config.js`

- Multi-stage: `build` (Vite build of `@portalai/web` — `npx turbo run build --filter=@portalai/web`), `runtime` = `nginxinc/nginx-unprivileged` serving `/usr/share/nginx/html` with SPA fallback (`try_files $uri /index.html`).
- **Entrypoint** (`docker-entrypoint.d/`-style script) renders `/usr/share/nginx/html/config.js` from container env at startup:

```js
// config.js (generated at container start)
window.__RUNTIME_CONFIG__ = {
  authProvider: "<auth0|oidc>",        // from AUTH_PROVIDER (default auth0)
  oidcIssuer: "<...>",                 // OIDC_ISSUER / VITE_AUTH0_DOMAIN
  oidcClientId: "<...>",               // OIDC_CLIENT_ID / VITE_AUTH0_CLIENT_ID
  oidcAudience: "<...>",               // OIDC_AUDIENCE / VITE_AUTH0_AUDIENCE
  deployMode: "<saas|residency>",      // DEPLOY_MODE
};
```

- `apps/web/index.html` loads `<script src="/config.js"></script>` **before** the app bundle. **#566 only produces `config.js` + loads it**; the SPA reading `window.__RUNTIME_CONFIG__` for auth is **#607** (until then, build-time `VITE_*` remains authoritative — no behavior change to the SaaS build).
- Web build+push added to `deploy-dev.yml`/`deploy-prod.yml` mirroring the API image step (`docker/build-push-action@v6`, `linux/arm64`, `file: apps/web/Dockerfile`, tag `<ecr>/web:dev-<sha>`).

### `deploy/helm/portalai/` — the chart

**`Chart.yaml`** — `apiVersion: v2`, `appVersion` = release SHA, `dependencies`:
- `postgresql` (Bitnami) `condition: postgresql.enabled`
- `redis` (Bitnami) `condition: redis.enabled`
- `minio` (Bitnami) `condition: minio.enabled`
- `keycloak` (Bitnami) `condition: bundledIssuer.enabled`

**`values.yaml`** (the contract) — shape:

```yaml
image:
  api:  { repository: "", tag: "", pullPolicy: IfNotPresent }
  web:  { repository: "", tag: "", pullPolicy: IfNotPresent }
imagePullSecrets: []
api:
  replicaCount: 1
  resources: { requests: {cpu,memory}, limits: {memory} }
  env: {}                    # extra/override env
web:
  replicaCount: 1
  resources: { … }
deployMode: saas             # saas | residency → DEPLOY_MODE
oidc:                        # feeds api validator + web config.js
  issuer: ""
  audience: ""
  clientId: ""
config: {}                   # non-secret env → ConfigMap
secrets: {}                  # secret env → Secret (or existingSecret)
existingSecret: ""
postgresql:
  enabled: true
  image: { repository: imresamu/postgis, tag: "17-3.5" }   # PostGIS override
  external: { host, port, database, user }                  # when enabled:false
redis:
  enabled: true
  master: { persistence: { enabled: true, size: 8Gi } }    # MANDATORY PVC
  external: { url }
minio:
  enabled: true
  external: { endpoint, forcePathStyle, bucket, region }
bundledIssuer:
  enabled: false            # Keycloak subchart
ingress:
  enabled: false
  className: ""
  host: ""
  tls: { enabled: false, secretName: "" }   # cert-manager annotations documented
migrate: { enabled: true }  # pre-install,pre-upgrade hook
seed:    { enabled: true }  # post-install hook
```

**`templates/`** inventory:
- `api-deployment.yaml` — env from ConfigMap+Secret; **liveness** `/api/health`, **readiness** `/api/health/ready`; resources; `securityContext: { runAsNonRoot: true, … }` (forward-compatible with #571).
- `api-service.yaml`, `web-deployment.yaml`, `web-service.yaml`.
- `configmap.yaml` (non-secret env incl. `DEPLOY_MODE`, `oidc.*`, `UPLOAD_S3_*` incl. #567's endpoint/path-style, `PUBLIC_API_BASE_URL`, `GOOGLE_*` non-secret), `secret.yaml` (gated on `existingSecret`).
- `migrate-job.yaml` — `helm.sh/hook: pre-install,pre-upgrade`, `hook-weight`, `hook-delete-policy: before-hook-creation,hook-succeeded`; command `["node","dist/scripts/db-migrate.js"]`.
- `seed-job.yaml` — `helm.sh/hook: post-install`; command `["node","dist/db/seed.js"]`.
- `ingress.yaml` (gated), `_helpers.tpl`, `NOTES.txt`.
- `values.schema.json` — JSON-schema validation of the above (helm validates on install).
- `README.md` — values reference + the `CREATE EXTENSION postgis` privilege prereq for external Postgres + cert-manager TLS note.

**Data-dep wiring:** `DATABASE_URL`/`REDIS_URL`/`UPLOAD_S3_*` composed in `_helpers.tpl` from the bundled subchart service names when `*.enabled`, else from `*.external`. `DB_MASTER_SECRET_ARN` never set.

### CI — `helm lint` + `helm template`

Add a job/step to `.github/workflows/static-checks.yml` (or a `scripts/check-helm.mjs`) running `helm lint deploy/helm/portalai` and `helm template` with (a) default values and (b) `*.enabled=false` external values — both must render without error. `globalDependencies`/turbo unaffected (chart is outside the build graph).

## Migration / Seed

**No new DB schema.** The readiness endpoint is code-only; no table/column/migration. The chart's migrate/seed **hooks run the existing** `db-migrate.js`/`seed.js` against the target DB — they execute current migrations (incl. `0076_enable-postgis.sql`, which needs the PostGIS image / extension privilege). No backfill.

## TDD test plan

### API — `apps/api/src/__tests__/routes/health.router.test.ts` (extend/new)
- `GET /api/health/ready` → **200** `{ ready:true, checks:{db:true,redis:true} }` when both stubs resolve.
- → **503** `{ ready:false, checks:{db:false,…} }` when the DB check throws (inject a failing `db.execute`).
- → **503** when `getRedisClient().ping()` rejects.
- Response validates against `HealthReadyResponseSchema`; `ApiCode.HEALTH_NOT_READY` on the 503 path.
- Liveness `GET /api/health` unchanged (regression). **≈5 cases.**

### Core contract — `packages/core/src/contracts/__tests__/health.contract.test.ts` (or existing contract test)
- `HealthReadyResponseSchema` accepts a valid payload, rejects a missing `checks` field. **≈2 cases.**

### Chart — `helm lint`/`helm template` (CI, not jest)
- `helm lint` clean; `helm template` renders with defaults **and** with all `*.enabled=false` + external values (asserts the `_helpers.tpl` external branch); a rendered api Deployment carries both probes and `runAsNonRoot`. Config.js entrypoint output validated in the smoke. **≈3 rendered assertions.**

**Totals ≈ 7 jest cases + 3 helm-render assertions.** Run via `npm run test:unit` (api, core); chart checks via the new `helm` CI step. No migration test (no schema change).

## Acceptance criteria

- [ ] `helm install portalai deploy/helm/portalai` on a clean EKS cluster comes up green with bundled PostGIS/Redis/MinIO; `CREATE EXTENSION postgis` succeeds via the overridden image.
- [ ] `/api/health` (liveness) and `/api/health/ready` (readiness, DB+Redis) both wired as probes; a pod with an unreachable DB is **not ready** (pulled from Service) but **not restarted**.
- [ ] SaaS-config login (Auth0) renders a portal against the installed stack.
- [ ] Residency config is **plumbed**: `config.js` is generated from env and loaded; `oidc.*` reaches api (validator) + web; `bundledIssuer.enabled=true` deploys Keycloak. (Live customer-OIDC login is #607.)
- [ ] `*.enabled=false` + external values render and point the app at managed Postgres/Redis/MinIO; **no AWS runtime dependency** (`DB_MASTER_SECRET_ARN` unset).
- [ ] Migrate runs as pre-install/upgrade hook (release aborts on failure); seed runs post-install.
- [ ] `helm lint`/`helm template` CI check green; `npm run build`/`type-check`/`lint`/`test:unit` green.

## Risks & rollback

- **Additive, low blast radius.** The chart is a new directory; the existing ECS/CloudFormation SaaS deploy is untouched. The readiness endpoint and `config.js` load are additive (SaaS build unchanged — `VITE_*` still authoritative until #607).
- **Readiness fail-closed is deliberate** — a DB/Redis outage pulls pods from the Service (correct) but must **not** feed liveness, or a blip becomes a restart storm (Decision 4). The timeout guard prevents a hung dep from hanging the probe.
- **Bundled deps are non-HA (evaluation-grade)** — a stated downgrade; production points at external managed HA via the toggles. Redis without its PVC would silently drop jobs — the PVC default + `values.schema.json` guard against a misconfigured disable.
- **Bitnami chart-repo dependency** — pinned chart versions in `Chart.lock`; if the repo is unavailable at package time, `helm dependency build` fails loudly (not silently).
- **Rollback:** don't ship the chart / `helm uninstall`. The API/web code changes are independently revertable and inert to the SaaS deploy.

## Files touched

- New: `deploy/helm/portalai/{Chart.yaml,values.yaml,values.schema.json,README.md,templates/*,NOTES.txt}`, `apps/web/Dockerfile`, `apps/web/nginx.conf` (+ entrypoint), `packages/core/src/contracts/__tests__/health.contract.test.ts` (if absent).
- Edit: `apps/api/src/routes/health.router.ts`, `packages/core/src/contracts/health.contract.ts`, `apps/api/src/constants/api-codes.constants.ts`, `apps/api/src/config/swagger.config.ts`, `apps/web/index.html`, `apps/api/src/__tests__/routes/health.router.test.ts`, `.github/workflows/{deploy-dev,deploy-prod,static-checks}.yml`.

## Next step

`/plan 566` (same branch) carves this into ~6 TDD slices: (1) `/api/health/ready` + contract + code + tests; (2) web image + `apps/web/Dockerfile` + config.js entrypoint + pipeline build; (3) chart skeleton (api+web Deployments/Services/ConfigMap/Secret + probes) + `helm lint` CI; (4) bundled data subcharts (PostGIS/Redis-PVC/MinIO) + external toggles + `_helpers.tpl`; (5) migrate/seed hook Jobs; (6) optional Ingress + Keycloak bundled-issuer + values docs. Each slice `helm template`- or jest-verifiable; the EKS green install is the smoke gate.

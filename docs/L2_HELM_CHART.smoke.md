# L2_HELM_CHART — Smoke Suite

Manual smoke test for [#566](https://github.com/EnterpriseBT/portal-ai/issues/566) — the L2 Helm chart (full-residency install: API + web + bundled/external data deps as one release), plus the `/api/health/ready` readiness endpoint and the residency web image's runtime `config.js`.

**Branch under test:** `feat/566-l2-helm-chart` (PR [#608](https://github.com/EnterpriseBT/portal-ai/pull/608), base `epic/enterprise-deployment`).

Run **§Preflight** once. §1–§2 are verifiable against the **local dev stack**; §3–§8 need a **Kubernetes cluster** (kind/minikube/EKS) and are the substance of the gate — this ticket's acceptance is a real `helm install`. Steps a browser can drive are marked walkable (`/smoke-walk`-eligible); everything requiring a cluster, a `docker`/`helm`/`kubectl` command, or vendor login is tagged **— manual**.

**Acceptance-criteria → section map** (every criterion is covered):

| Spec acceptance criterion | Section(s) |
|---|---|
| `helm install` green on a clean cluster; bundled PostGIS/Redis/MinIO; `CREATE EXTENSION postgis` succeeds | §3 |
| `/api/health` + `/api/health/ready` wired as probes; unreachable-DB pod not-ready but not restarted | §1, §3 |
| SaaS Auth0 login renders a portal against the installed stack | §5 |
| Residency config plumbed: `config.js` generated + loaded; `oidc.*` reaches api+web; `bundledIssuer` deploys Keycloak | §2, §4 |
| `*.enabled=false` + external values point at managed deps; no AWS runtime dep (`DB_MASTER_SECRET_ARN` unset) | §6 |
| migrate = pre-install/upgrade hook (aborts on failure); seed = post-install | §7 (also §3) |
| `helm lint`/`template` CI green; `build`/`type-check`/`lint`/`test:unit` green | §Preflight |

Filing bugs: open an issue against `EnterpriseBT/portal-ai`, type `Bug`, link this file's section (template at the bottom).

---

## Preflight

### Environment — local (for §1–§2)

- [ ] `git checkout feat/566-l2-helm-chart && git pull --ff-only`
- [ ] `npm install && npm run build --workspace=@portalai/core` — the readiness contract (`HealthReadyResponse`) is new in core; the API needs the rebuilt dist. **No DB migration** — the readiness endpoint is code-only.
- [ ] `npm run dev` boots cleanly (API `:3001`, web `:3000`); Redis + Postgres reachable (the readiness probe checks both).

### Environment — cluster (for §3–§8) — manual

- [ ] A cluster is available: `kubectl cluster-info` responds (kind/minikube for eval, EKS for the real acceptance).
- [ ] `helm dependency build deploy/helm/portalai` succeeds (pulls the pinned Bitnami subcharts from `Chart.lock`).
- [ ] The `portalai-api` + `portalai-web` images are reachable from the cluster (built by the pipeline, or `docker build -f apps/api/Dockerfile .` / `-f apps/web/Dockerfile .` and loaded, e.g. `kind load docker-image`).

### CI / static gates (the last acceptance criterion)

- [ ] PR #608 shows **Static Checks** (incl. the `helm lint`/`template` step), **Unit Tests**, **Integration Tests** all green.
- [ ] Locally: `npm run type-check`, `npm run lint`, `npm run lint:helm` pass; `npm run test:unit` green for `@portalai/core`, `@portalai/api`, `@portalai/web`.

### Reset between runs

- [ ] Local (§1–§2): none needed — read-only. Restart `npm run dev` after stopping a dep for the 503 test.
- [ ] Cluster (§3+): `helm uninstall portalai` and delete its PVCs (`kubectl delete pvc -l app.kubernetes.io/instance=portalai`) before a fresh bundled install, or the old data volumes are reused.

---

## §1 — Readiness & liveness endpoints (local — walkable)

The one API change. Liveness is deps-free; readiness checks DB + Redis and is **fail-closed**.

- [x] Navigate to `http://localhost:3001/api/health` → **200**, body `{ success:true, payload:{ timestamp, version, sha } }`. (walkable) — ✅ agent-verified 2026-09-17: `200` `{"success":true,"payload":{"timestamp":"2026-09-17T03:25:06.204Z","version":"dev","sha":"local"}}`
- [x] Navigate to `http://localhost:3001/api/health/ready` → **200**, `payload:{ ready:true, checks:{ db:true, redis:true }, timestamp }`. (walkable) — ✅ agent-verified 2026-09-17: `200` `{"ready":true,"checks":{"db":true,"redis":true},"timestamp":"2026-09-17T03:25:06.218Z"}`
- [ ] Stop Redis (e.g. `docker compose stop redis`, or point `REDIS_URL` at a dead port and restart the API). Hit `/api/health/ready` → **503**, body `{ success:false, code:"HEALTH_NOT_READY", details:{ ready:false, checks:{ db:true, redis:false }, timestamp } }`. — manual (stopping a dep)
- [ ] With Redis still down, `/api/health` (liveness) still returns **200** — liveness does not depend on Redis (this is why a DB/Redis blip pulls the pod from Service but never restarts it). — manual
- [ ] Restart Redis; `/api/health/ready` returns to **200**. — manual

---

## §2 — Residency web image + runtime `config.js` (local docker — agent-verified)

One built image serves any customer; auth/runtime config is written from container env at startup. SPA *consumption* is #607 — here we verify the file is generated and loaded. Walked in-container via DooD `docker build` + `docker exec` (2026-09-17).

- [x] `docker build -f apps/web/Dockerfile -t portalai-web:smoke566 .` succeeds. — ✅ agent-verified (after fixing the Dockerfile to also copy `packages/spreadsheet-parsing`, which `@portalai/core` imports; the build failed without it).
- [x] Container with `-e DEPLOY_MODE=residency -e AUTH_PROVIDER=oidc -e OIDC_ISSUER=… -e OIDC_CLIENT_ID=… -e OIDC_AUDIENCE=…` → `/usr/share/nginx/html/config.js` = `window.__RUNTIME_CONFIG__ = {"AUTH_PROVIDER":"oidc","OIDC_ISSUER":"https://id.example","OIDC_CLIENT_ID":"portalai-web","OIDC_AUDIENCE":"https://api.example","DEPLOY_MODE":"residency"}`. — ✅ agent-verified (read via `docker exec cat`).
  - Note: in the chart, `AUTH_PROVIDER` is derived from `deployMode` (see §4); the image honors an explicit `AUTH_PROVIDER` env when set.
- [x] Container with **no** OIDC env → `config.js` = `{"AUTH_PROVIDER":"auth0","OIDC_ISSUER":"","OIDC_CLIENT_ID":"","OIDC_AUDIENCE":"","DEPLOY_MODE":"saas"}` (SaaS defaults). — ✅ agent-verified.
- [x] `/etc/nginx/conf.d/default.conf`: `location = /config.js` sets `Cache-Control "no-store"`; `location /` does `try_files $uri $uri/ /index.html` (SPA fallback). — ✅ agent-verified (config present in the running container; header directive active).
- [x] `/usr/share/nginx/html/index.html`: `<script src="/config.js">` (line 12) loads **before** the module bundle (line 55). — ✅ agent-verified.
- [x] Container runs **non-root**: `id` → `uid=101(nginx)`. — ✅ agent-verified (also relevant to §3's non-root workloads).
- [ ] SaaS unchanged: the normal `npm run dev` web app still logs in via build-time `VITE_*` (config.js is not consumed for auth until #607). — manual (app-level, not the image)

---

## §3 — Bundled install on a cluster (— manual)

The core acceptance: one release, bundled data deps, schema migrated, seeded.

- [ ] `helm install portalai deploy/helm/portalai --set image.api.repository=<repo> --set image.api.tag=<tag> --set image.web.repository=<repo> --set image.web.tag=<tag>` returns without error.
- [ ] `kubectl get pods` — `portalai-api`, `portalai-web`, `portalai-postgresql-0`, `portalai-redis-master-0`, `portalai-minio-*` all reach **Running/Ready**.
- [ ] **PostGIS:** `kubectl exec portalai-postgresql-0 -- psql -U portalai -d portalai -c '\dx'` lists `postgis` — i.e. migration `0076` (`CREATE EXTENSION postgis`) succeeded against the `imresamu/postgis` bundled image. **This is the flagged risk** (Bitnami subchart + foreign image); if the DB pod crash-loops or the extension is absent, file a bug and fall back to external managed PostGIS (§6).
- [ ] **Migrate hook ran:** `kubectl get jobs` shows `portalai-migrate` **Complete**; the schema exists (`\dt` shows app tables). (See the bundled-DB first-install caveat in the chart README — on a bundled first install the `pre-install` hook can't reach the not-yet-created DB; if so, this is the expected caveat, not a regression.)
- [ ] **Seed hook ran:** `portalai-seed` job **Complete** (post-install); global seed rows present (e.g. tiers).
- [ ] **Probes wired:** `kubectl describe deploy portalai-api` shows liveness `GET /api/health` and readiness `GET /api/health/ready`.
- [ ] **Readiness fail-closed, no restart:** scale the bundled DB to 0 (`kubectl scale statefulset portalai-postgresql --replicas=0`). The api pod goes **Not Ready** (removed from the Service endpoints) but its **restart count does not increase**. Scale back to 1 → api returns Ready. This is the liveness-vs-readiness invariant.
- [ ] Pods run **non-root**: `kubectl get pod <api-pod> -o jsonpath='{.spec.securityContext.runAsNonRoot}'` → `true`.

---

## §4 — Residency config plumbed (— manual)

Config reaches both workloads; the bundled issuer is optional. (Live customer-OIDC login is **#607**, out of scope.)

- [ ] Install with `--set deployMode=residency --set oidc.issuer=https://id.example --set oidc.audience=https://api.example --set oidc.clientId=portalai-web`.
- [ ] Web pod: `kubectl exec <web-pod> -- cat /usr/share/nginx/html/config.js` shows `AUTH_PROVIDER:"oidc"` (derived from `deployMode=residency`), the `OIDC_*` values, and `DEPLOY_MODE:"residency"`.
- [ ] API pod: `kubectl exec <api-pod> -- printenv | grep -E 'OIDC_|DEPLOY_MODE'` shows the same `OIDC_ISSUER`/`OIDC_AUDIENCE` and `DEPLOY_MODE=residency` (reaches the API validator).
- [ ] `helm upgrade ... --set bundledIssuer.enabled=true` → a `portalai-keycloak-*` pod appears; with it `false` (default), no Keycloak objects exist.

---

## §5 — SaaS Auth0 login renders a portal (— manual)

- [ ] Install (or `helm upgrade`) with SaaS config: `--set deployMode=saas`, Auth0 values in `config`/`secrets` (`AUTH0_DOMAIN`, `VITE_AUTH0_*` baked in the web image or via config), and an ingress or `kubectl port-forward svc/portalai-web 8080:8080` + `svc/portalai-api 3001:3001`.
- [ ] Open the web app, log in via Auth0, and confirm a **portal renders** against the installed stack (data served by the in-cluster API + DB). This is the end-to-end "the chart actually runs the app" check.

---

## §6 — External managed data deps (— manual; render is CI-covered)

Production points at managed Postgres/Redis/MinIO; no AWS runtime dependency.

- [ ] `helm template` sanity (local, also gated by `npm run lint:helm`): with `--set postgresql.enabled=false --set redis.enabled=false --set minio.enabled=false` + `*.external.*` values, **no** `portalai-postgresql`/`-redis`/`-minio` objects render, and `DATABASE_URL`/`REDIS_URL`/`UPLOAD_S3_ENDPOINT` in the Secret/ConfigMap point at the external endpoints.
- [ ] Install against real managed endpoints (or a second in-cluster instance standing in): the app comes up Ready and reads/writes against the external Postgres/Redis/MinIO.
- [ ] **No AWS runtime dep:** `kubectl exec <api-pod> -- printenv | grep DB_MASTER_SECRET_ARN` returns **nothing** — the DB password travels in `DATABASE_URL`, not via an AWS secret ARN.

---

## §7 — Hooks & lifecycle (— manual)

- [ ] `kubectl get job portalai-migrate -o jsonpath='{.metadata.annotations}'` shows `helm.sh/hook: pre-install,pre-upgrade` and command `node dist/scripts/db-migrate.js`; `portalai-seed` shows `post-install` and `node dist/db/seed.js`.
- [ ] **Migrate aborts a bad release:** point the migrate at an unreachable/failing DB (e.g. wrong external password) on a `helm install`/`upgrade`. The release **fails** (the pre-install hook Job errors) rather than rolling out api pods against an un-migrated DB.
- [ ] `--set migrate.enabled=false --set seed.enabled=false` → neither Job is created (`kubectl get jobs` shows none).

---

## §8 — Deploy pipeline (— manual, at app-dev)

Un-CI'd by design (no PR behind the deploy workflows); validated when the epic reaches app-dev.

- [ ] `deploy-dev.yml` run: the **Build and push web image** step pushes `portalai-web:dev-<sha>` to the web ECR repo (multi-arch amd64+arm64).
- [ ] `backend.yml` created the `portalai-<env>-web` ECR repository and exports `<env>-WebEcrRepositoryUri`.
- [ ] The API image build/push is unchanged (regression check).

---

## Sign-off

- [ ] §1 (readiness/liveness) — 200/503 with the failed dep named; liveness deps-free.
- [ ] §2 (web config.js) — rendered from env, no-store, loaded before the bundle; SaaS unchanged.
- [ ] §3 (bundled install) — all pods Ready; PostGIS extension present; migrate+seed hooks Complete; readiness fail-closed without restart; non-root.
- [ ] §4 (residency config) — config.js + api env carry oidc.*/DEPLOY_MODE; Keycloak toggles.
- [ ] §5 (SaaS login) — Auth0 login renders a portal against the installed stack.
- [ ] §6 (external deps) — external path renders no subcharts, points at managed endpoints, no `DB_MASTER_SECRET_ARN`.
- [ ] §7 (hooks) — hook annotations/commands correct; migrate aborts a bad release; toggles work.
- [ ] §8 (pipeline) — web image builds+pushes; web ECR repo created.
- [ ] ______ (date + name) — confirmed against my own running stack/cluster.

> Gate: PR #608 merges (into `epic/enterprise-deployment`) only after CI is green **and** the above is confirmed. Live customer-OIDC login is proven with **#607**; full bundled-MinIO S3 wiring with **#567**.

---

## Bug-filing template

```
**Section:** §<X> — <name>
**Step:** <which step>
**Expected:** <what the smoke doc says>
**Got:** <kubectl output / pod logs / curl output / screenshots>
**Repro:** <helm command + values + preconditions>
**Identifiers:** <release name, pod names, job ids>
```

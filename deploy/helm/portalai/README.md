# Portals AI Helm chart

Installs the whole application — the API, the standalone web SPA, and its data
dependencies — as **one Helm release**, for the full-residency (self-hosted)
deployment (#566). It is **additive**: the SaaS deployment (ECS + S3/CloudFront)
is untouched.

Data dependencies (PostgreSQL/PostGIS, Redis, MinIO) are **bundled by default**
for evaluation and **disable-able to managed endpoints** for production.

## Prerequisites

- Kubernetes 1.25+ and Helm 3.8+.
- The `portalai-api` and `portalai-web` images (built by the deploy pipeline)
  reachable from the cluster — mirror them into your registry and set
  `image.api.*` / `image.web.*`.
- **External PostgreSQL only:** the DB user must be able to run
  `CREATE EXTENSION postgis` (migration `0076`). Managed PostGIS (e.g. RDS with
  the `postgis` extension enabled, or a superuser-run `CREATE EXTENSION`) is
  required — a plain Postgres without PostGIS fails migration.

## Install

Bundled data deps (evaluation):

```bash
helm dependency build deploy/helm/portalai
helm install portalai deploy/helm/portalai \
  --set image.api.repository=<registry>/portalai-api --set image.api.tag=<tag> \
  --set image.web.repository=<registry>/portalai-web --set image.web.tag=<tag>
```

External managed data deps (production):

```bash
helm install portalai deploy/helm/portalai \
  --set image.api.repository=<registry>/portalai-api --set image.api.tag=<tag> \
  --set image.web.repository=<registry>/portalai-web --set image.web.tag=<tag> \
  --set postgresql.enabled=false \
  --set postgresql.external.host=<db-host> \
  --set postgresql.external.password=<db-password> \
  --set redis.enabled=false \
  --set redis.external.url=redis://<redis-host>:6379 \
  --set minio.enabled=false \
  --set minio.external.endpoint=https://<s3-endpoint> \
  -f my-secrets.yaml   # secrets: { ENCRYPTION_KEY: ..., ANTHROPIC_API_KEY: ..., ... }
```

## Values reference

| Key | Default | Description |
|---|---|---|
| `image.api.repository` / `.tag` | `""` | API image (required). |
| `image.web.repository` / `.tag` | `""` | Web image (required). |
| `imagePullSecrets` | `[]` | Pull secrets for a private registry. |
| `deployMode` | `saas` | `saas` \| `residency`. Sets `DEPLOY_MODE` (API auth validator) and the web `config.js`. |
| `oidc.issuer` / `.audience` / `.clientId` | `""` | Customer OIDC identity (residency). Reaches the API validator and the web `config.js`. |
| `config` | `{}` | Non-secret env → ConfigMap (e.g. `AUTH0_DOMAIN`, `PUBLIC_API_BASE_URL`, `CORS_ORIGIN`). |
| `secrets` | `{}` | Secret env → Secret (e.g. `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `AUTH0_WEBHOOK_SECRET`, `STRIPE_*`, `OAUTH_STATE_SECRET`). |
| `existingSecret` | `""` | Use a pre-created Secret instead of rendering one from `secrets`. |
| `api.replicaCount` / `web.replicaCount` | `1` | Replicas. |
| `api.resources` / `web.resources` | see values | Resource requests/limits. |
| `postgresql.enabled` | `true` | Bundle PostgreSQL (PostGIS image). `false` → use `postgresql.external`. |
| `postgresql.image.*` | `imresamu/postgis:17-3.5` | Bundled DB image (PostGIS). |
| `postgresql.auth.*` | `portalai` | Bundled DB user/password/database. |
| `postgresql.external.*` | `""` | Managed DB host/port/database/user/password. |
| `redis.enabled` | `true` | Bundle Redis (mandatory PVC). `false` → `redis.external.url`. |
| `redis.master.persistence.size` | `8Gi` | Redis PVC size (durable BullMQ store). |
| `minio.enabled` | `true` | Bundle MinIO. `false` → `minio.external.*`. Full S3 wiring lands with #567. |
| `migrate.enabled` | `true` | Run migrations as a `pre-install,pre-upgrade` hook Job. |
| `seed.enabled` | `true` | Run global seeds as a `post-install` hook Job. |
| `ingress.enabled` | `false` | Route `/api` → API, `/` → web on `ingress.host`. |
| `ingress.className` | `""` | IngressClass. |
| `ingress.tls.enabled` / `.secretName` | `false` / `""` | TLS via a (cert-manager-issued) secret. |
| `bundledIssuer.enabled` | `false` | Deploy a bundled Keycloak fallback OIDC issuer. |

## Notes & caveats

- **Bundled PostGIS is a smoke risk.** The Bitnami `postgresql` subchart is
  built around a Bitnami image; the `imresamu/postgis` override uses the
  official Postgres entrypoint/data-dir conventions, so `global.security.allowInsecureImages`
  is set and runtime compatibility must be confirmed on a real cluster.
  Production should use **managed PostGIS** (`postgresql.enabled=false`).
- **Bundled-DB first install + migrate.** The `migrate` hook is
  `pre-install,pre-upgrade`; on a *first install with the bundled DB* the DB is
  created in the main phase and is not reachable during `pre-install`. Either
  install against an external DB, or set `migrate.enabled=false` and run the
  migration once the bundled DB is up. `pre-upgrade` (DB already exists) is
  unaffected. This is why production points at an external managed DB.
- **Bundled deps are evaluation-grade** (non-HA, in-cluster). Production points
  at external managed HA services via the `enabled: false` toggles.
- **TLS.** With `ingress.tls.enabled=true`, provide `ingress.tls.secretName`.
  For cert-manager, add the issuer annotation via `ingress.annotations`
  (e.g. `cert-manager.io/cluster-issuer: letsencrypt`).
- **Bitnami catalog.** Subchart versions are pinned and `Chart.lock` is
  committed; `helm dependency build` fails loudly if a pinned chart is moved or
  removed (Bitnami is restricting its free catalog).
- **No AWS runtime dependency.** `DB_MASTER_SECRET_ARN` is never set; the DB
  password is carried in the `DATABASE_URL` Secret.

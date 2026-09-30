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
| `postgresql.external.migrationUser` / `.migrationPassword` / `.migrationExistingSecret.{name,key}` | `""` / `""` / `""`,`password` | Optional migration-only user for an external DB whose app user lacks CREATEROLE (#660). Only the migrate/upgrade jobs receive it. See *Restricted SQL reader role* below. |
| `redis.enabled` | `true` | Bundle Redis (mandatory PVC). `false` → `redis.external.url`. |
| `redis.master.persistence.size` | `8Gi` | Redis PVC size (durable BullMQ store). |
| `minio.enabled` | `true` | Bundle MinIO. `false` → `minio.external.*`. Full S3 wiring lands with #567. |
| `migrate.enabled` | `true` | Run first-install migrations as a `pre-install` hook Job. |
| `seed.enabled` | `true` | Run first-install global seeds as a `post-install` hook Job. |
| `upgrade.enabled` | `true` | On `helm upgrade`, run migrations + seeds as one advisory-locked `pre-upgrade` hook Job (`db:upgrade`). |
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
- **Upgrades run one job, with one signal (#581).** On `helm upgrade` the
  `upgrade` hook (`pre-upgrade`) runs `db:upgrade` — pending migrations + the
  idempotent global seed, under a session advisory lock so two concurrent passes
  never both migrate. It prints `UPGRADE COMPLETE` and exits non-zero on failure;
  watch `kubectl logs job/<release>-upgrade`. Prefer `helm upgrade --atomic`: a
  failed upgrade then rolls the *workloads* back automatically, while the
  expand-only schema stays valid under the previous image. Migrations are
  forward-only — a mistake is undone by a new forward migration, never a
  down-migration. Set `upgrade.enabled=false` to fall back to migrate-only.
- **Bundled-DB first install + migrate.** The first-install `migrate` hook is
  `pre-install`; on a *first install with the bundled DB* the DB is created in
  the main phase and is not reachable during `pre-install`. Either install
  against an external DB, or set `migrate.enabled=false` and run the migration
  once the bundled DB is up. The `pre-upgrade` path (DB already exists) is
  unaffected. This is why production points at an external managed DB.
- **Bundled deps are evaluation-grade** (non-HA, in-cluster). Production points
  at external managed HA services via the `enabled: false` toggles.
- **TLS.** With `ingress.tls.enabled=true`, provide `ingress.tls.secretName`.
  For cert-manager, add the issuer annotation via `ingress.annotations`
  (e.g. `cert-manager.io/cluster-issuer: letsencrypt`).
- **Bitnami catalog.** Subchart versions are pinned and `Chart.lock` is
  committed; `helm dependency build` fails loudly if a pinned chart is moved or
  removed (Bitnami is restricting its free catalog).
- **Restricted SQL reader role (#660).** Agent SQL runs under a NOLOGIN
  Postgres role (`PORTAL_SQL_READER_ROLE`, default `portalai_sql_reader`, set
  it through `config`) that can read only each session's own views. Migration
  `0118` creates it, which needs a user with CREATEROLE:
  - **Bundled DB:** the migrate/upgrade jobs use the subchart's `postgres`
    superuser automatically (`MIGRATE_DATABASE_URL`, jobs only).
  - **External DB:** set `postgresql.external.migrationUser` to the schema
    owner or another CREATEROLE user, with `migrationPassword` or
    `migrationExistingSecret`. The password is placed in the URL as-is, so it
    must be URL-safe.
  - **Or provision it by hand** once, as a privileged user, then migrate as
    the app user as usual:
    ```sql
    CREATE ROLE portalai_sql_reader NOLOGIN;
    GRANT portalai_sql_reader TO <app user> WITH SET TRUE;  -- PG16+; plain GRANT before 16
    GRANT USAGE ON SCHEMA public TO portalai_sql_reader;
    ```

  Without a usable role the API still boots, but every SQL tool (and map
  tiles over session views) refuses with `PORTAL_SQL_UNAVAILABLE` (503); it
  never runs agent SQL with the app user's privileges. The API logs
  `portal-sql.reader-role-ok` or `portal-sql.reader-role-unavailable` (with
  the reason) at boot, and re-checks on the next SQL call, so no restart is
  needed once the role exists. The role must hold no grants of its own: the
  check refuses a role that can read any application table.
- **No AWS runtime dependency.** `DB_MASTER_SECRET_ARN` is never set; the DB
  password is carried in the `DATABASE_URL` Secret.

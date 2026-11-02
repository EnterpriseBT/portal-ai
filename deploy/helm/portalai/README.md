# Portals AI Helm chart

Installs the whole application — the API, the standalone web SPA, and its data
dependencies — as **one Helm release**, for the full-residency (self-hosted)
deployment (#566). It is **additive**: the SaaS deployment (ECS + S3/CloudFront)
is untouched.

Data dependencies (PostgreSQL/PostGIS, Redis, S3-compatible object storage)
are **bundled by default** for evaluation and **disable-able to managed
endpoints** for production. The bundled deps are this chart's own single-replica
StatefulSets on maintained upstream images (#946): `imresamu/postgis`,
`redis`, `chrislusf/seaweedfs` (SeaweedFS, for S3) and, optionally,
`quay.io/keycloak/keycloak` as the OIDC issuer. The chart has no subchart
dependencies, so there is no `helm dependency build` step.

## Prerequisites

- Kubernetes 1.25+ and Helm 3.8+.
- The `portalai-api` and `portalai-web` images (built by the deploy pipeline)
  reachable from the cluster — mirror them into your registry and set
  `image.api.*` / `image.web.*`.
- **External PostgreSQL only:** the DB user must be able to run
  `CREATE EXTENSION postgis` (migration `0076`). Managed PostGIS (e.g. RDS with
  the `postgis` extension enabled, or a superuser-run `CREATE EXTENSION`) is
  required — a plain Postgres without PostGIS fails migration.
  It must also be able to run `CREATE EXTENSION pg_trgm` (migration `0126`,
  #649; trigram indexes for curated-view search). pg_trgm is a trusted contrib
  extension, so the database owner can create it on any Postgres 13+ that ships
  contrib (RDS does); otherwise a superuser pre-creates it.

## Install

Bundled data deps (evaluation):

```bash
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
  --set redis.external.url=rediss://<redis-host>:6379 \
  --set objectStorage.enabled=false \
  --set objectStorage.external.endpoint=https://<s3-endpoint> \
  -f my-secrets.yaml   # secrets: { ENCRYPTION_KEY: ..., ANTHROPIC_API_KEY: ..., ... }
```

The Redis URL's scheme is the TLS switch (#852): `rediss://` connects over TLS, `redis://` in the clear. A managed Redis with in-transit encryption needs `rediss://`. If its certificate is signed by a private CA, put the CA's PEM in a Secret and name it: `--set redis.external.tls.caSecret.name=<secret>` (key `ca.crt` by default). The API refuses to start with a CA set on a `redis://` URL.

## Values reference

| Key | Default | Description |
|---|---|---|
| `image.api.repository` / `.tag` | `""` | API image (required). |
| `image.web.repository` / `.tag` | `""` | Web image (required). |
| `imagePullSecrets` | `[]` | Pull secrets for a private registry. |
| `deployMode` | `saas` | `saas` \| `residency`. Sets `DEPLOY_MODE` (API auth validator) and the web `config.js`. A residency install sets `residency` explicitly; the API then refuses to boot without `oidc.issuer`/`.audience` or with central Stripe credentials (`apps/api/src/config/deploy-mode.ts`). |
| `oidc.issuer` / `.audience` / `.clientId` | `""` | Customer OIDC identity (residency). Reaches the API validator and the web `config.js`. |
| `config` | `{}` | Non-secret env → ConfigMap (e.g. `AUTH0_DOMAIN`, `PUBLIC_API_BASE_URL`, `WEB_APP_URL`, `CORS_ORIGIN`). `WEB_APP_URL` (invite links) and `PUBLIC_API_BASE_URL` (where webhook toolpack runtimes call back) default from `ingress.host`. Without the chart's ingress, set them here. A missing `WEB_APP_URL` refuses invitations; a missing `PUBLIC_API_BASE_URL` only stops webhook tools that stream data in, or return results too large to send inline (`WEBHOOK_CALLBACK_UNCONFIGURED`), so an install without custom webhook toolpacks can leave it. The install notes and a startup warning name either one. |
| `secrets` | `{}` | Secret env → Secret (e.g. `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `OAUTH_STATE_SECRET`). Never `STRIPE_SECRET_KEY`/`STRIPE_WEBHOOK_SECRET` on a residency install: the API refuses to boot with them. |
| `existingSecret` | `""` | Use a pre-created Secret instead of rendering one from `secrets`. |
| `api.replicaCount` / `web.replicaCount` | `1` | Replicas. |
| `web.basemap.mode` | `none` | Map basemap for every map, whatever its own spec names: `none` (data on a plain background, no tile traffic), `custom` (your tile server) or `default` (CARTO + OpenStreetMap, third-party egress). See *Egress*. |
| `web.basemap.styleUrl` / `.styleUrlDark` | `""` | With `custom`: a MapLibre style JSON URL or a raster XYZ template (`https://…/{z}/{x}/{y}.png`); `styleUrl` is required, `styleUrlDark` optional (used in the dark theme). Must be `http(s)`. A template supports `{z}`, `{x}` and `{y}` only; a Leaflet-style `{s}` subdomain isn't expanded, so name one host. |
| `web.basemap.attribution` | `""` | Attribution shown for an XYZ template; a style JSON carries its own. |
| `api.resources` / `web.resources` | see values | Resource requests/limits. |
| `postgresql.enabled` | `true` | Bundle PostgreSQL (PostGIS image). `false` → use `postgresql.external`. |
| `postgresql.image.*` | `imresamu/postgis:17-3.5` | Bundled DB image (PostGIS, arm64 + amd64). |
| `postgresql.auth.username` / `.password` / `.database` | `portalai` | The bundled DB's app user, which owns the database. |
| `postgresql.auth.postgresPassword` | `""` | The bundled DB's `postgres` superuser, used only by the migrate/upgrade jobs. Generated on first install and kept in the `<release>-portalai-postgresql` Secret unless set. |
| `postgresql.persistence.size` / `redis.persistence.size` / `objectStorage.persistence.size` / `bundledIssuer.persistence.size` | `8Gi` / `8Gi` / `20Gi` / `1Gi` | Each bundled dep's volume; `.storageClass` picks its class. |
| `postgresql.external.*` | `""` | Managed DB host/port/database/user/password. |
| `postgresql.external.migrationUser` / `.migrationPassword` / `.migrationExistingSecret.{name,key}` | `""` / `""` / `""`,`password` | Optional privileged user for an external DB whose app user lacks CREATEROLE; used only to create the SQL reader role and grant it to the app user (#660). Only the migrate/upgrade jobs receive it. See *Restricted SQL reader role* below. |
| `redis.enabled` | `true` | Bundle Redis 7.4 (append-only file on its volume: the durable BullMQ store). `false` → `redis.external.url`. |
| `redis.external.url` | `""` | Managed Redis URL. `rediss://` connects over TLS (#852). |
| `redis.external.tls.caSecret.{name,key}` | `""`,`ca.crt` | Secret holding a private CA's PEM for a `rediss://` URL; reaches the API as `REDIS_TLS_CA`. Leave empty when the cert chains to a public root. |
| `objectStorage.enabled` | `true` | Bundle SeaweedFS as the S3 store. `false` → `objectStorage.external.*`. |
| `objectStorage.publicHost` | `""` | The object store's public hostname, served by the chart's ingress. **Uploads need it**: browsers PUT to presigned URLs, which carry this host. |
| `objectStorage.bucket` | `portalai-uploads` | Bundled bucket, created by a post-install/post-upgrade Job. |
| `objectStorage.auth.accessKey` / `.secretKey` | `portalai` / `""` | The app's S3 credentials, scoped to the bucket. The secret key is generated on first install and kept in the `<release>-portalai-s3` Secret unless set. |
| `objectStorage.external.*` | see values | External S3 endpoint/region/bucket/path style. Credentials come from `secrets` (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) or the pod's cloud identity. |
| `migrate.enabled` | `true` | Run first-install migrations: a `pre-install` hook with an external DB; with the bundled DB, a Job that waits for it (the API and seed wait for its migrations). |
| `seed.enabled` | `true` | Run first-install global seeds as a `post-install` hook Job. |
| `upgrade.enabled` | `true` | On `helm upgrade`, run migrations + seeds as one advisory-locked `pre-upgrade` hook Job (`db:upgrade`). |
| `ingress.enabled` | `false` | Route `/api` → API, `/` → web on `ingress.host`. |
| `ingress.className` | `""` | IngressClass. |
| `ingress.tls.enabled` / `.secretName` | `false` / `""` | TLS via a (cert-manager-issued) secret. |
| `bundledIssuer.enabled` | `false` | Deploy Keycloak as the OIDC issuer, with a `portalai` realm and SPA client imported at start; `oidc.*` default from it (an explicit `oidc.*` value wins). Needs `ingress.enabled` + `ingress.host`. |
| `bundledIssuer.host` | `""` | The issuer's public hostname, served by the chart's ingress. Browsers and the API pods must both resolve it. |
| `bundledIssuer.realm` / `.clientId` / `.audience` | `portalai` / `portalai-web` / `portalai-api` | Realm, SPA client and the access token `aud` the API validates. |
| `bundledIssuer.admin.username` / `.password` | `admin` / `""` | Keycloak's bootstrap admin. The password is generated on first install and kept in the `<release>-portalai-keycloak` Secret unless set. |

## Notes & caveats

- **Bundled deps are evaluation-grade** (single replica, no HA, no backups,
  in-cluster). Production points at managed services through the
  `enabled: false` toggles: managed PostGIS, Redis and S3.
- **Upgrades run one job, with one signal (#581).** On `helm upgrade` the
  `upgrade` hook (`pre-upgrade`) runs `db:upgrade` — pending migrations + the
  idempotent global seed, under a session advisory lock so two concurrent passes
  never both migrate. It prints `UPGRADE COMPLETE` and exits non-zero on failure;
  watch `kubectl logs job/<release>-upgrade`. Prefer `helm upgrade --atomic`: a
  failed upgrade then rolls the *workloads* back automatically, while the
  expand-only schema stays valid under the previous image. Migrations are
  forward-only — a mistake is undone by a new forward migration, never a
  down-migration. Set `upgrade.enabled=false` to fall back to migrate-only.
- **First install with the bundled DB.** The bundled DB is part of the
  release, so it doesn't exist during `pre-install`. The migration therefore
  runs as a plain Job that waits for the DB, and the API pods and the seed
  hook wait for its migrations before they start. `helm install --wait` works
  as usual. With an external DB the migration is a `pre-install` hook.
- **Bundled issuer users.** The realm has no self-registration: create each
  user in Keycloak's admin console (`https://<bundledIssuer.host>/admin/`, the
  install notes print how to read the admin password) and mark the email
  verified. Realm changes made there survive restarts and upgrades: the import
  skips a realm that already exists.
- **TLS.** With `ingress.tls.enabled=true`, provide `ingress.tls.secretName`.
  For cert-manager, add the issuer annotation via `ingress.annotations`
  (e.g. `cert-manager.io/cluster-issuer: letsencrypt`).
- **No Bitnami.** The chart used Bitnami subcharts until #946. Their pinned
  images are gone from `docker.io/bitnami`, and MinIO no longer publishes
  images, so the bundled deps moved to the chart's own templates. The
  `minio.*` values are now `objectStorage.*`; the schema refuses `minio`.
- **Restricted SQL reader role (#660).** Agent SQL runs under a NOLOGIN
  Postgres role (`PORTAL_SQL_READER_ROLE`, default `portalai_sql_reader`, set
  it through `config`) that can read only each session's own views. Migration
  `0118` creates it, which needs a user with CREATEROLE. The migrate/upgrade
  jobs use a privileged `MIGRATE_DATABASE_URL` (jobs only) **just to create
  the role and grant it to the app user**; the schema migrations still run as
  the app user, so it keeps owning every table:
  - **Bundled DB:** its `postgres` superuser is used automatically.
  - **External DB:** set `postgresql.external.migrationUser` to a superuser
    or CREATEROLE user, with `migrationPassword` or
    `migrationExistingSecret`. The password reaches the job as its own
    variable (`MIGRATE_DATABASE_PASSWORD`), never inside the URL, so it needs
    no URL-encoding.
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
- **After restoring a database onto another cluster, provision the role
  again.** Roles belong to the cluster, not the database, so a `pg_dump`
  restore doesn't bring the reader role, and `db:upgrade` won't recreate it:
  migration `0118` is already recorded as applied. The API then refuses SQL
  tools (`reader-role-unavailable … does not exist`) until the role exists.
  Re-apply `0118` as a CREATEROLE user, or run the manual statements above.
- **No AWS runtime dependency.** `DB_MASTER_SECRET_ARN` is never set; the DB
  password is carried in the `DATABASE_URL` Secret. (AWS Marketplace
  entitlement, if enabled, is the exception: the Entitlement Service is
  us-east-1 only.)

## Egress

What the install sends outside the cluster is decided per vector in the
deployment security review (`docs/DEPLOYMENT_SECURITY_REVIEW.md` §1), which
lists every server-side and browser-side call with its switch. The ones a
residency operator most often needs to know about:

- **LLM.** Every model call goes to `ANTHROPIC_BASE_URL` when it is set (a
  proxy or self-hosted gateway), and to Anthropic directly when it isn't. Some
  callers send record or sample values; the review lists which.
- **Map basemaps (browser).** The chart defaults `web.basemap.mode` to
  `none`: maps draw their data on a plain background and browsers fetch no
  tiles. Set `custom` with a `styleUrl` to use a tile server you run (its style
  and tiles must allow CORS from the app's origin), or `default` to use CARTO
  and OpenStreetMap, which then receive each viewer's IP and map viewport. The
  setting applies to every map, including a map whose spec names its own
  basemap URL. If a `custom` basemap fails (its style errors or hasn't loaded
  within 10 seconds, or its tiles fail before any loads), maps still render
  their data and show "Basemap unavailable".
- **Running the web image without this chart.** The image's own default is
  `BASEMAP_MODE=default` (CARTO + OpenStreetMap), the SaaS behaviour. Set
  `BASEMAP_MODE` (and `BASEMAP_STYLE_URL` for `custom`) in its environment;
  an unknown mode, or `custom` without a valid URL, renders no basemap.
- **Optional tools and connectors.** Web search, geocoding and the Google and
  Microsoft connectors are off unless their keys are set.

## Security review & image verification

- Complete `docs/DEPLOYMENT_SECURITY_REVIEW.md` with the customer before the
  install ships.
- Verify both images (`image.api`, `image.web`) before mirroring them: each
  is Trivy-gated, SBOM-attested and cosign-signed, the web image for both of
  its platforms (`docs/SUPPLY_CHAIN.md` → "Verifying a published image").
  The web image's scan covers its OS packages and node. The nginx binary
  comes from nginx.org's repository, outside Trivy's data, so it is tracked
  separately: the image runs the stable line with no dynamic modules, and a
  weekly check compares the pinned version against nginx.org's security
  advisories (`docs/SUPPLY_CHAIN.md`). Record the image's nginx version
  (`nginx -v`) in the review.

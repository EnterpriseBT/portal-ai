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

## Local evaluation cluster

A full residency install on one machine: Docker Desktop's Kubernetes, the
bundled data deps, and the bundled Keycloak as the identity provider (#946).

**Why hostnames, not port-forwards.** The OIDC issuer and the object store
are each reached by the browser *and* by the API pods, under one URL: the
token's `iss` must match the issuer the API checks, and a presigned upload
URL's host is part of its signature. A port-forward gives the browser
`localhost:<port>`, which inside a pod is the pod itself. So each service gets
a `*.localhost` name: browsers resolve those to loopback and treat them as a
secure context (PKCE works over http), Docker Desktop publishes the ingress
controller's LoadBalancer on localhost:80, and a CoreDNS rewrite sends the
same names to the ingress controller inside the cluster.

1. **Cluster.** Docker Desktop → Settings → Kubernetes → enable. From this
   repo's devcontainer, which mounts the host's `~/.kube` read-only at
   `/root/.kube-host`, point a copy at the host's API server:
   ```bash
   mkdir -p ~/.kube
   sed 's#https://127.0.0.1:6443#https://kubernetes.docker.internal:6443#' \
     /root/.kube-host/config > ~/.kube/config
   kubectl get nodes
   ```
2. **Ingress controller (Traefik).**
   ```bash
   helm repo add traefik https://traefik.github.io/charts
   helm install traefik traefik/traefik --version 42.0.0 \
     -n traefik --create-namespace --wait
   ```
3. **In-cluster DNS.** Add this block to the CoreDNS Corefile, after
   `ready` (`kubectl -n kube-system edit cm coredns`), then
   `kubectl -n kube-system rollout restart deploy/coredns`:
   ```
   rewrite stop {
      name regex (.*\.)?portalai\.localhost\.$ traefik.traefik.svc.cluster.local.
      answer auto
   }
   ```
   Check from a pod:
   `kubectl run dns --rm -i --restart=Never --image=busybox:1.37 -- nslookup auth.portalai.localhost`
   should answer with Traefik's ClusterIP.
4. **Images.** Build both into Docker Desktop's image store, which the
   cluster uses directly (no registry):
   ```bash
   docker build -f apps/api/Dockerfile --build-arg BUILD_VERSION=<v> -t portalai-api:<v> .
   docker build -f apps/web/Dockerfile --build-arg BUILD_VERSION=<v> -t portalai-web:<v> .
   ```
5. **Install** with a values file like this, plus `secrets` holding
   `ENCRYPTION_KEY` and `OAUTH_STATE_SECRET` (`openssl rand -base64 32`
   each) and `ANTHROPIC_API_KEY`:
   ```yaml
   image:
     api: { repository: portalai-api, tag: "<v>", pullPolicy: Never }
     web: { repository: portalai-web, tag: "<v>", pullPolicy: Never }
   deployMode: residency
   ingress: { enabled: true, className: traefik, host: portalai.localhost }
   bundledIssuer: { enabled: true, host: auth.portalai.localhost }
   objectStorage: { publicHost: s3.portalai.localhost }
   ```
   ```bash
   helm install portalai deploy/helm/portalai -n portalai --create-namespace \
     -f local-values.yaml --wait
   ```
6. **Sign in.** Create a user at `http://auth.portalai.localhost/admin/`
   (realm `portalai`, email verified, a non-temporary password), then open
   `http://portalai.localhost`. The first user becomes the organization's
   owner; later users join it as members.

A browser running *inside* the devcontainer (the Playwright MCP) resolves
`*.localhost` to the container itself. Forward the container's port 80 to the
host's (`host.docker.internal:80`) for it; a browser on the host needs nothing.

## Values reference

| Key | Default | Description |
|---|---|---|
| `image.api.repository` / `.tag` | `""` | API image (required). |
| `image.web.repository` / `.tag` | `""` | Web image (required). |
| `imagePullSecrets` | `[]` | Pull secrets for a private registry. |
| `deployMode` | `saas` | `saas` \| `residency`. Sets `DEPLOY_MODE` (API auth validator) and the web `config.js`. A residency install sets `residency` explicitly; the API then refuses to boot without `oidc.issuer`/`.audience` or with central Stripe credentials (`apps/api/src/config/deploy-mode.ts`). |
| `oidc.issuer` / `.audience` / `.clientId` | `""` | Customer OIDC identity (residency). Reaches the API validator and the web `config.js`. |
| `config` | `{}` | Non-secret env → ConfigMap. `SYSTEM_ID` is the install's system principal (see *The system principal is write-once* below): set it once at install, a UUID recommended, or leave it out for `SYSTEM`. Others, e.g. `AUTH0_DOMAIN`, `PUBLIC_API_BASE_URL`, `WEB_APP_URL`, `CORS_ORIGIN`. `WEB_APP_URL` (invite links) and `PUBLIC_API_BASE_URL` (where webhook toolpack runtimes call back) default from `ingress.host`. Without the chart's ingress, set them here. A missing `WEB_APP_URL` refuses invitations; a missing `PUBLIC_API_BASE_URL` only stops webhook tools that stream data in, or return results too large to send inline (`WEBHOOK_CALLBACK_UNCONFIGURED`), so an install without custom webhook toolpacks can leave it. The install notes and a startup warning name either one. |
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
| `objectStorage.publicHost` | `""` | The object store's public hostname (no port), served by the chart's ingress. **Uploads need it**: browsers PUT to presigned URLs, which carry this host. |
| `objectStorage.bucket` | `portalai-uploads` | Bundled bucket, created by a post-install/post-upgrade Job. |
| `objectStorage.auth.accessKey` / `.secretKey` | `portalai` / `""` | The app's S3 credentials, scoped to the bucket. The secret key is generated on first install and kept in the `<release>-portalai-s3` Secret unless set. |
| `objectStorage.external.*` | see values | External S3 endpoint/region/bucket/path style. Credentials come from `secrets` (`AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY`) or the pod's cloud identity. |
| `migrate.enabled` | `true` | Run first-install migrations: a `pre-install` hook with an external DB; with the bundled DB, a Job that waits for it (the API and seed wait for its migrations). A first install with the bundled DB refuses `false`, since nothing else can migrate it. |
| `seed.enabled` | `true` | Run first-install global seeds as a `post-install` hook Job. |
| `upgrade.enabled` | `true` | On `helm upgrade`, run migrations + seeds as one advisory-locked `pre-upgrade` hook Job (`db:upgrade`). |
| `ingress.enabled` | `false` | Route `/api` → API, `/` → web on `ingress.host`. |
| `ingress.className` | `""` | IngressClass. |
| `ingress.tls.enabled` / `.secretName` | `false` / `""` | TLS via a (cert-manager-issued) secret. |
| `bundledIssuer.enabled` | `false` | Deploy Keycloak as the OIDC issuer, with a `portalai` realm and SPA client imported at start; `oidc.*` default from it (an explicit `oidc.*` value wins). Needs `ingress.enabled` + `ingress.host`. |
| `bundledIssuer.host` | `""` | The issuer's public hostname (no port), served by the chart's ingress. Browsers and the API pods must both resolve it. |
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
  read it with `kubectl logs job/<release>-upgrade`. The job is kept until the
  next upgrade replaces it, a failed one included, so its log stays readable.
  Prefer `helm upgrade --atomic`: a failed upgrade then rolls the *workloads*
  back automatically, while the expand-only schema stays valid under the
  previous image (on a local cluster, an upgrade to an image that couldn't be
  pulled failed its hook and rolled back while the app kept serving). Migrations are
  forward-only — a mistake is undone by a new forward migration, never a
  down-migration. Set `upgrade.enabled=false` to fall back to migrate-only.
- **Hook jobs read their own copy of the env.** A `pre-install` or
  `pre-upgrade` hook runs before Helm creates or updates the release's
  ConfigMap and Secret, so the migrate and upgrade jobs load
  `<release>-portalai-hook-config` and `-hook-secret`, rendered from the same
  values just before them. A value added or changed by an upgrade reaches that
  upgrade's migrations. With `existingSecret`, the jobs read your Secret
  directly, so update it before the upgrade. Helm deletes the copies once the
  hooks succeed; a failed run keeps them until the next one.
- **What `helm uninstall` leaves.** Hook objects aren't part of the release:
  the last migrate, seed and upgrade Jobs (kept for their logs) and, after a
  failed upgrade, the hook copies of the env. The bundled deps' volumes stay
  too, as with any StatefulSet. To remove everything:
  `kubectl -n <ns> delete job,configmap,secret,pvc -l app.kubernetes.io/instance=<release>`.
- **Bundled passwords are set on first start.** Postgres applies
  `postgresql.auth.password` / `.postgresPassword` only when it initializes an
  empty volume, and Keycloak applies `bundledIssuer.admin.password` only when it
  bootstraps. Changing one after install updates the chart's Secrets but not
  the service, and the app or jobs then fail to authenticate. To rotate, change
  the password in the service first (`ALTER ROLE`, Keycloak's admin console),
  then set the value.
- **The system principal is write-once (#953).** `config.SYSTEM_ID` is the
  id every platform-created row carries as `createdBy` (seeds, provisioned
  defaults, migration backfills), and the id members' "read what the platform
  provisioned" grants match. Set it at install, a UUID is recommended so the
  install's system rows are traceable to it (prod does the same), or leave it
  out for `SYSTEM`. After that it never changes: an upgrade that sets a
  different value fails (`config.SYSTEM_ID is write-once…`) before anything is
  applied, because a new id would strand every row written under the old one.
  An upgrade that leaves it out keeps the installed value, read back from the
  release's ConfigMap. The check reads the release's objects, not the
  database, so it guards upgrades of a live release only:
  - under `helm template` / GitOps (no `lookup`) it doesn't run. Set the value
    explicitly on every render; leaving it out renders `SYSTEM`, and a changed
    value applies unchecked;
  - a reinstall over a database that outlived the release (an external DB, a
    kept PVC, a changed `fullnameOverride`) isn't checked either. Reuse the
    original value. A database-side guard is tracked separately.
- **Generated passwords need `lookup`.** An empty password is generated once
  and kept by reading the existing Secret back, which works under
  `helm install`/`upgrade` against a cluster. `helm template`, `--dry-run` and
  GitOps renderers (Argo CD, Flux in template mode) can't read the cluster, so
  they draw a new value on every render. There, set
  `postgresql.auth.postgresPassword`, `objectStorage.auth.secretKey` and
  `bundledIssuer.admin.password` explicitly (e.g. from a sealed or external
  secret).
- **First install with the bundled DB.** The bundled DB is part of the
  release, so it doesn't exist during `pre-install`. The migration therefore
  runs as a plain Job that waits for the DB, and the API pods and the seed
  hook wait for its migrations before they start. `helm install --wait` works
  as usual. With an external DB the migration is a `pre-install` hook.
- **Bundled issuer over http.** Without ingress TLS the `portalai` realm
  accepts plain http (`sslRequired: none`); with TLS it requires https for
  non-private clients. Keycloak's own `master` realm, which serves the admin
  console, always requires https for non-private clients, so on an http
  install reach the console from a private network or with
  `kubectl port-forward`. The realm is imported once, so a later TLS change
  doesn't alter it.
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

# Mock client install: Helm chart on a local cluster — Condensed design (#946)

**Issue:** [EnterpriseBT/portal-ai#946](https://github.com/EnterpriseBT/portal-ai/issues/946) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Nobody has installed `deploy/helm/portalai` (#566) on a real cluster, and the next prod release waits on a mock client install. This run installs it the way a customer operator would, on Docker Desktop Kubernetes with the bundled data deps and the bundled Keycloak as the residency IdP, then upgrades it. Reading the chart against the API already shows gaps that would stop the install, and the bundled deps can't even be pulled: every image the pinned Bitnami subcharts reference is gone from `docker.io/bitnami`, and MinIO no longer publishes images (the repo's e2e stack already moved off it). The rest gets found by doing it. Touches `deploy/helm/portalai`, `scripts/check-helm.mjs` and the devcontainer `Dockerfile`; no app code.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Bundled deps | `deploy/helm/portalai/Chart.yaml:18-34` | Four Bitnami subcharts. All 14 images they pin are missing from `docker.io/bitnami` (checked 2026-11-02); `bitnamilegacy` has frozen, unpatched copies. |
| Bundled Keycloak | `deploy/helm/portalai/values.yaml:239`, `Chart.yaml:31` | `bundledIssuer.enabled` installs a bare Keycloak: no realm, no client, no audience, nothing feeds `oidc.*`. Nothing can sign in. |
| API token check | `apps/api/src/middleware/auth.middleware.ts:28-29` | `issuerBaseURL` is the issuer itself, so the **pod** fetches discovery/JWKS from the same URL the **browser** got its token from. |
| Residency boot guard | `apps/api/src/config/deploy-mode.ts:92` | Refuses to boot without `OIDC_ISSUER` + `OIDC_AUDIENCE`. |
| Bundled S3 endpoint | `deploy/helm/portalai/templates/_helpers.tpl:88-94`, `configmap.yaml:71` | `http://<release>-minio:9000`, an in-cluster name. Presigned upload URLs carry that host, so a browser PUT can't resolve it. |
| S3 credentials | `apps/api/src/environment.ts:305-308` | AWS SDK chain only. The chart never passes MinIO's root credentials, so uploads fail unless the operator copies them into `secrets` by hand. |
| First-install migrate | `deploy/helm/portalai/templates/migrate-job.yaml:14` | `pre-install` hook, so it runs before the bundled DB exists (documented trap). |
| Chart gate | `scripts/check-helm.mjs`, `npm run lint:helm` | `helm lint` + `helm template` scenario assertions; Static Checks runs it. |
| helm in devcontainer | `Dockerfile:75-81` | Pinned release tarball; no `kubectl`. |

## Decision — one hostname per service, the same from the browser and from inside the cluster

The OIDC issuer and the S3 endpoint are each used by both the browser and the API pod, and each must be the **same URL** for both (the token's `iss` must match; a presigned URL's host is signed). A customer has real DNS, which gives them this for free; a local cluster doesn't.
- **Port-forward** (no ingress): the browser sees `localhost:<port>`, which inside a pod is the pod itself. Doesn't work.
- **Split URLs** (a separate internal JWKS/S3 URL): a new API config seam, i.e. an app contract change, to solve a local-only problem. No.
- **Chosen: Traefik ingress + `*.localhost` names + a CoreDNS rewrite.** `portalai.localhost` (app + `/api`), `auth.portalai.localhost` (Keycloak), `s3.portalai.localhost` (MinIO). Browsers resolve `*.localhost` to loopback, and that origin counts as a secure context, so the PKCE crypto works over http. Docker Desktop exposes Traefik's LoadBalancer on localhost:80. A CoreDNS `rewrite` sends the three names to Traefik's service inside the cluster. Traefik rather than ingress-nginx because ingress-nginx was retired in 2026. This is cluster setup, documented in the README; the chart only gains the hostnames.

## Decision — the chart owns its bundled deps (amended)

Repointing at `bitnamilegacy` keeps frozen, unpatched images that Bitnami may also remove; swapping to four other vendors' charts trades one dependency for four. The bundled deps are single-replica and evaluation-grade by contract, so the chart renders them itself: a StatefulSet + Service (+ PVC) each, on maintained images pinned by tag: `imresamu/postgis` (arm64 + amd64; the official `postgis/postgis` has no arm64), `redis:7.4-alpine` (matches ElastiCache's line), `chrislusf/seaweedfs` (Apache-2.0, S3 API) and `quay.io/keycloak/keycloak`. No subcharts, no `Chart.lock`, no `helm dependency build`. Owning the Postgres StatefulSet also removes the foreign-image smoke risk, and lets the bundled-DB migrate hook run `post-install` behind a wait for the DB, so the first-install trap disappears instead of being documented. `minio.*` values become `objectStorage.*`; there are no installs to migrate.

SeaweedFS was chosen by probe, not by reputation: with the app's own S3 client (`@aws-sdk/client-s3`, path-style) it created the bucket, answered a CORS preflight and a presigned PUT from a browser origin, served the object back and refused a wrong secret. RustFS passed the S3 calls but sent no CORS headers until a bucket CORS rule was set; `adobe/s3mock` is a test mock.

## Decision — the bundled Keycloak works out of the box

The README promises "a fallback OIDC issuer for installs with no customer IdP", so the chart must deliver one rather than send the operator into the Keycloak console. With `bundledIssuer.enabled`, Keycloak imports a `portalai` realm from a chart ConfigMap at start (`--import-realm`). The realm gets a public SPA client (PKCE S256, redirect + web origin = the app origin, which is what the SPA sends) and an audience mapper; the SPA asks for `openid profile email offline_access` (`apps/web/src/providers/Auth.provider.tsx:307`) and the API reads the user's email from the issuer's userinfo on first login (`apps/api/src/middleware/metadata.middleware.ts:67-80`), so both must be granted. When `oidc.*` is empty, the chart fills it in from `bundledIssuer.host`, so `OIDC_ISSUER` = `http(s)://<host>/realms/portalai`. Users are created by the operator in Keycloak (the realm disables self-registration). Explicit `oidc.*` values always win.

## Decision — bundled object storage is reachable and credentialed by default

With `objectStorage.enabled`, `UPLOAD_S3_ENDPOINT` comes from `objectStorage.publicHost` (served by the chart's ingress) when set, falling back to the in-cluster service only when it isn't. The API pods get `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from the chart's object-storage Secret, and a hook Job creates the bucket.

## Decision — upgrade from a real release

Install images built from the last release tag (`v1.1.2`), then `helm upgrade --atomic` to images built from this branch, so the upgrade job applies real pending migrations. Images are built with `docker build` from `apps/api/Dockerfile` / `apps/web/Dockerfile` into Docker Desktop (natively arm64), and the cluster uses them without a registry (`pullPolicy: IfNotPresent`).

## Plan — 3 slices

1. **kubectl in the devcontainer.** Files: `Dockerfile` (pinned `kubectl`, release binary + checksum, beside helm). Check: rebuild, then `kubectl version --client`.
2. **Chart-owned bundled deps + the known gaps.** Files: `deploy/helm/portalai/Chart.yaml` (dependencies dropped, `Chart.lock` deleted), `values.yaml`, `values.schema.json`, `templates/_helpers.tpl`, `configmap.yaml`, `secret.yaml`, `api-deployment.yaml`, `ingress.yaml`, `migrate-job.yaml`, `seed-job.yaml`, `NOTES.txt`, new `templates/{postgresql,redis,object-storage,keycloak}.yaml` + the bucket Job; `.gitignore`'s `charts/` entry. Tests: `scripts/check-helm.mjs` scenarios rewritten to the new objects, test-first (bundled defaults: four StatefulSets on maintained images, no `bitnami`/`minio` anywhere; bundled-DB migrate is `post-install` with a DB wait; bundled issuer → realm ConfigMap + derived `OIDC_*`; explicit `oidc.*` wins; object storage public endpoint + credential env; external path renders none of them); its dependency-build step removed. `npm run lint:helm`.
3. **The live run + its findings.** Walk the Smoke below; each finding becomes a fix (plus a `check-helm.mjs` scenario where it's a render bug) or a README correction. Files: chart README gains a "Local evaluation cluster" section (Traefik, hostnames, CoreDNS rewrite, image builds); its bundled-PostGIS and first-install notes are rewritten to what was observed. A real app bug gets its own Bug ticket.

## Smoke (manual, against your Docker Desktop cluster)

1. Docker Desktop → Kubernetes enabled; `kubectl get nodes` from the devcontainer shows `Ready`.
2. Traefik installed, CoreDNS rewrite applied; from a throwaway pod, `nslookup auth.portalai.localhost` resolves to Traefik's service.
3. Build `v1.1.2` API + web images; `helm install` with bundled deps, `deployMode=residency`, `bundledIssuer.enabled=true`, ingress on, nothing else. Every image pulls; the migrate job waits for the bundled DB and applies; the API logs `portal-sql.reader-role-ok`; all pods `Ready`.
4. Create a user in Keycloak; open `http://portalai.localhost`, sign in through Keycloak, land in the app with an organization.
5. Create a station (a write succeeds); upload a small CSV through the file import (presigned PUT to MinIO succeeds, records appear).
6. Build this branch's images; `helm upgrade --atomic`; `kubectl logs job/<release>-upgrade` shows `UPGRADE COMPLETE`; the station and records are still there.
7. `helm upgrade --atomic` with a nonexistent image tag fails, rolls back, and the app keeps serving the previous release.
8. `npm run lint:helm` passes.

## Live run — 2026-11-02 (Docker Desktop Kubernetes v1.36.1, arm64)

All eight smoke steps passed after the fixes below; Traefik chart 42.0.0 (newest older than two weeks).

| Found | Fix |
|---|---|
| Bundled-DB migrate wait hung: it runs as uid 1000, absent from the postgres image's passwd, so `pg_isready` without `-U` never attempted a connection | `-U <app user>` (`check-helm` scenario) |
| Web pod refused: image `USER nginx` is non-numeric, so `runAsNonRoot` can't verify it | `web.podSecurityContext.runAsUser/runAsGroup: 101` (scenario) |
| Every first sign-in 500'd: the chart never set `SYSTEM_ID`, so user creation failed `createdBy` validation | chart-owned `SYSTEM_ID: "SYSTEM"` (the migrations' literal), any other value refused (scenario + reject) |
| Hook jobs read stale/missing env: `pre-upgrade` runs before the release ConfigMap/Secret update (the new `SYSTEM_ID` missed that upgrade's seed); an external-DB `pre-install` migrate referenced a ConfigMap/Secret that didn't exist yet | env rendered from shared templates (`_env.tpl`) into hook-scoped copies at weight −10 (scenarios incl. `existingSecret`) |
| `UPGRADE COMPLETE` unreadable: hook jobs were deleted on success | hook jobs kept until the next run (`before-hook-creation`) |
| `/api/health` said `dev`: `BUILD_*` set only in the image's build stage (ECS injects them, the chart doesn't) | `ARG`/`ENV` in the API runtime stage |

**App bugs for their own ticket** (not fixed here): `SeedService.seed()` swallows its error and exits 0, so a failed seed reports success (also inside `db:upgrade`); the metadata middleware logs `error.message` under the `error` key, which `sanitizeError` reduces to `{"type":"string"}`, hiding the cause of `METADATA_FETCH_FAILED`; the API boots without `SYSTEM_ID` and fails only at first sign-in.

## Out of scope

- The staging-account install (EKS, RDS, ElastiCache, S3, mirrored + cosign-verified images): follow-up ticket.
- AWS Marketplace listing and entitlement (#568): deferred.
- TLS, HA, backups, external customer IdPs.

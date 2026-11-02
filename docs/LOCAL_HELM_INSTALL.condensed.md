# Mock client install: Helm chart on a local cluster — Condensed design (#946)

**Issue:** [EnterpriseBT/portal-ai#946](https://github.com/EnterpriseBT/portal-ai/issues/946) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Nobody has installed `deploy/helm/portalai` (#566) on a real cluster, and the next prod release waits on a mock client install. This run installs it the way a customer operator would, on Docker Desktop Kubernetes with the bundled data deps and the bundled Keycloak as the residency IdP, then upgrades it. Reading the chart against the API already shows three gaps that would stop the install. The rest gets found by doing it. Touches `deploy/helm/portalai`, `scripts/check-helm.mjs` and the devcontainer `Dockerfile`; no app code.

## Current shape

| Piece | Location | Note |
|---|---|---|
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

## Decision — the bundled Keycloak works out of the box

The README promises "a fallback OIDC issuer for installs with no customer IdP", so the chart must deliver one rather than send the operator into the Keycloak console. With `bundledIssuer.enabled`, the chart provisions a `portalai` realm through the Bitnami subchart's `keycloakConfigCli`. The realm gets a public SPA client (PKCE, redirect + web origin = the app host) and an audience mapper. When `oidc.*` is empty, the chart fills it in from `bundledIssuer.host`, so `OIDC_ISSUER` = `http(s)://<host>/realms/portalai`. Users are created by the operator in Keycloak (the realm disables self-registration). Explicit `oidc.*` values always win.

## Decision — bundled MinIO is reachable and credentialed by default

With `minio.enabled`, `UPLOAD_S3_ENDPOINT` comes from a new `minio.publicEndpoint` (the MinIO ingress host) when set, falling back to the in-cluster service only when it isn't. The API pods get `AWS_ACCESS_KEY_ID`/`AWS_SECRET_ACCESS_KEY` from the MinIO subchart's Secret. Run against the real browser upload; adjust MinIO CORS only if the PUT is refused.

## Decision — upgrade from a real release

Install images built from the last release tag (`v1.1.2`), then `helm upgrade --atomic` to images built from this branch, so the upgrade job applies real pending migrations. Images are built with `docker build` from `apps/api/Dockerfile` / `apps/web/Dockerfile` into Docker Desktop (natively arm64), and the cluster uses them without a registry (`pullPolicy: IfNotPresent`).

## Plan — 3 slices

1. **kubectl in the devcontainer.** Files: `Dockerfile` (pinned `kubectl`, release binary + checksum, beside helm). Check: rebuild, then `kubectl version --client`.
2. **Chart fixes for the known gaps.** Files: `deploy/helm/portalai/{values.yaml,values.schema.json,templates/_helpers.tpl,templates/configmap.yaml,templates/api-deployment.yaml}`, plus the Keycloak realm config. Tests: new scenarios in `scripts/check-helm.mjs` (bundled issuer → realm job + derived `OIDC_ISSUER`; explicit `oidc.*` wins; MinIO public endpoint + credential env), test-first; `npm run lint:helm`.
3. **The live run + its findings.** Walk the Smoke below; each finding becomes a fix (plus a `check-helm.mjs` scenario where it's a render bug) or a README correction. Files: chart README gains a "Local evaluation cluster" section (Traefik, hostnames, CoreDNS rewrite, image builds); its bundled-PostGIS and first-install notes are rewritten to what was observed. A real app bug gets its own Bug ticket.

## Smoke (manual, against your Docker Desktop cluster)

1. Docker Desktop → Kubernetes enabled; `kubectl get nodes` from the devcontainer shows `Ready`.
2. Traefik installed, CoreDNS rewrite applied; from a throwaway pod, `nslookup auth.portalai.localhost` resolves to Traefik's service.
3. Build `v1.1.2` API + web images; `helm install` with bundled deps, `deployMode=residency`, `bundledIssuer.enabled=true`, ingress on, `migrate.enabled=false`. Bundled Postgres comes up; run the migration; the API logs `portal-sql.reader-role-ok`; all pods `Ready`.
4. Create a user in Keycloak; open `http://portalai.localhost`, sign in through Keycloak, land in the app with an organization.
5. Create a station (a write succeeds); upload a small CSV through the file import (presigned PUT to MinIO succeeds, records appear).
6. Build this branch's images; `helm upgrade --atomic`; `kubectl logs job/<release>-upgrade` shows `UPGRADE COMPLETE`; the station and records are still there.
7. `helm upgrade --atomic` with a nonexistent image tag fails, rolls back, and the app keeps serving the previous release.
8. `npm run lint:helm` passes.

## Out of scope

- The staging-account install (EKS, RDS, ElastiCache, S3, mirrored + cosign-verified images): follow-up ticket.
- AWS Marketplace listing and entitlement (#568): deferred.
- TLS, HA, backups, external customer IdPs.

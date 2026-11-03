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

Branch `chore/946-local-helm-install`, PR [#947](https://github.com/EnterpriseBT/portal-ai/pull/947). Untagged steps are agent-walkable through the in-container browser with the `:80` forwarder (chart README → Local evaluation cluster); `— backend` is kubectl/helm from the devcontainer; `— manual` needs your Mac's browser. Every box starts unchecked.

**Preflight**
- [ ] Docker Desktop → Kubernetes enabled; README steps 1–3 done (kubeconfig copy, Traefik `42.0.0`, CoreDNS rewrite). — backend
- [ ] Images built (README step 4): `portalai-api:1.1.2` + `portalai-web:1.1.2` from tag `v1.1.2`, and this branch's as `portalai-api:946` + `portalai-web:946`. — backend
- [ ] Reset: `helm uninstall portalai -n portalai; kubectl delete ns portalai` (the namespace takes the PVCs with it). — backend

**Steps**
1. [ ] `kubectl get nodes` shows `docker-desktop` `Ready`; `kubectl run dns --rm -i --restart=Never --image=busybox:1.37 -- nslookup auth.portalai.localhost` answers Traefik's ClusterIP. — backend
2. [ ] `helm install` with `v1.1.2` images and the README step 5 values (`deployMode: residency`, bundled issuer, ingress, `objectStorage.publicHost`), `--wait`, completes. Every pod is `Ready`, `portalai-migrate` and `portalai-seed` are `Complete`, and no pod pulls a `bitnami*` or `minio` image (`kubectl -n portalai get pods -o jsonpath='{..image}'`). — backend
3. [ ] `kubectl -n portalai logs deploy/portalai-api -c api | grep portal-sql.reader-role-ok` matches. In psql, `select count(*) from connector_definitions` = 5. `s3.bucket.list` on `portalai-s3-0` lists `portalai-uploads`. `kubectl -n portalai get cm,secret | grep hook` is empty. — backend
4. [ ] Create a user at `http://auth.portalai.localhost/admin/` (realm `portalai`, email verified, non-temporary password). — manual
5. [ ] Open `http://portalai.localhost` **from the Mac's browser**, sign in through Keycloak, and land on the dashboard showing "My Organization" with "My Station". — manual
6. [ ] Stations → New Station → Name "Helm smoke 946" → Create. The card appears.
7. [ ] Connectors → Catalog → File Upload → upload a 3-row CSV, drag the region over all its cells, click **+ Add row axis**, create a new entity, Interpret, Commit plan. Network shows `PUT http://s3.portalai.localhost/portalai-uploads/…` → 200. The entity has 3 records with their fields.
8. [ ] `helm upgrade --atomic` to the `946` images. `kubectl -n portalai logs job/portalai-upgrade` shows `UPGRADE COMPLETE (migrations: 1, seed: ok)`. The station and records remain, `/api/health` reports the branch version, and no hook ConfigMap/Secret is left. — backend
9. [ ] `helm upgrade --atomic --timeout 2m` with `image.*.tag=does-not-exist` fails and reports `Rollback to <n>`. A `curl` loop on `http://portalai.localhost/api/health` stays 200 throughout. A later good upgrade replaces the failed upgrade Job. — backend
10. [ ] `npm run lint:helm` passes. Each of these is refused at render: `--set migrate.enabled=false` (bundled DB), `--set bundledIssuer.host=auth.example.com:8443`, `--set config.SYSTEM_ID=other`. — backend
11. [ ] After `helm uninstall`, `kubectl -n portalai delete job,configmap,secret,pvc -l app.kubernetes.io/instance=portalai` leaves nothing of the release. — backend

**Acceptance → step:** README from scratch, running and reachable → 1–3, 5 · Keycloak sign-in + org + write → 4–6 · `reader-role-ok` → 3 · upgrade `UPGRADE COMPLETE` + data intact → 8 · failing upgrade rolls back and keeps serving → 9 · first install needs no workaround → 2 · maintained images only → 2. Uploads (decision) → 7. Review fixes → 3, 9–11.

**Sign-off**
- [ ] Every step above verified against my own Docker Desktop cluster — <date, name>

Bug template: Step · Expected · Got · Repro · Identifiers (release revision, pod/job names).

## Adversarial (probes against the same cluster)

How the install breaks, not whether it works. Same preflight and tags as Smoke; `T` = a user access token from the `portalai` realm. In-browser token capture: the SPA's `/api` requests carry it. Every box starts unchecked.

**§1 Boundary & malformed values** (render-time; `helm template … <flag>`)
- [ ] `--set objectStorage.bucket='a;rm -rf /'` and `--set bundledIssuer.realm='x"}'` → schema refusal; nothing renders into the bucket Job's shell or the realm JSON. — backend
- [ ] `--set bundledIssuer.enabled=true` with `ingress.enabled=false` → refused ("needs the chart's ingress"). — backend
- [ ] `--set minio.enabled=true` → refused (the schema rejects `minio`). — backend
- [ ] `--set config.SYSTEM_ID=SYSTEM` renders `SYSTEM_ID` once; `config.SYSTEM_ID=other` is refused. — backend

**§2 Auth boundaries (bundled Keycloak + API)**
- [ ] A token from Keycloak's `master` realm (admin-cli) sent to `GET /api/organization/current` → `401`, issuer mismatch. — backend
- [ ] A `portalai`-realm token with no `portalai-api` audience (e.g. an ID token in the Bearer header) → `401`. — backend
- [ ] Open `…/realms/portalai/protocol/openid-connect/auth?client_id=portalai-web&redirect_uri=http://evil.example&response_type=code&code_challenge=x&code_challenge_method=S256` → Keycloak "Invalid parameter: redirect_uri"; no code is issued.
- [ ] `POST …/realms/portalai/protocol/openid-connect/token` with `grant_type=password` for the portalai-web client → refused (direct access grants are off). — backend
- [ ] The login page shows no "Register" link, and `…/registrations?client_id=portalai-web` doesn't offer sign-up.

**§3 Object storage boundaries**
- [ ] Unsigned `curl http://s3.portalai.localhost/portalai-uploads/<a key from step 7>` → `403`/`AccessDenied`. — backend
- [ ] With the app's own keys (`portalai-s3` Secret), `CreateBucket other` and `ListBuckets` → denied; Get/Put inside `portalai-uploads` → allowed. — backend
- [ ] A presigned PUT URL replayed after `X-Amz-Expires` (30 min), or with its host changed → `403`. — backend
- [ ] The ingress exposes only S3: `curl -H 'Host: s3.portalai.localhost' http://<traefik>/` reaches the gateway; the master `:9333` and filer `:8888` are not on any ingress host. — backend

**§4 Single-org residency (tenant shape)**
- [ ] A second Keycloak user signs in → joins the existing "My Organization" as **member**, not a new org or an owner (`organization_users.role`). — manual
- [ ] That member's Settings shows no owner-only actions, and a direct API call to an owner-only route → `403 PERMISSION_DENIED`. — backend

**§5 State & lifecycle**
- [ ] `kubectl delete pod portalai-postgresql-0 portalai-redis-0 portalai-s3-0` mid-session → the pods return; stations, records and the uploaded object survive; the API's readiness recovers with no restart. — backend
- [ ] Disable the user in Keycloak → its refresh fails and the SPA returns to sign-in; signing in again is refused. — manual
- [ ] Kill the upgrade Job's pod mid-run (`kubectl delete pod -l app.kubernetes.io/component=upgrade`) → the Job retries; the final log shows `UPGRADE COMPLETE`; `drizzle.__drizzle_migrations` has no duplicate rows. — backend
- [ ] Two `helm upgrade`s started together → the second is refused ("another operation … in progress"); the release ends `deployed`. — backend
- [ ] `helm upgrade --set objectStorage.bucket=renamed-uploads` → the SeaweedFS pod rolls, the hook creates `renamed-uploads`, and a new upload lands there. — backend

**§6 Misuse sequences**
- [ ] Open the app at `http://localhost` (Traefik's default host) rather than `portalai.localhost` → no app route; never a half-signed-in state.
- [ ] Install without `objectStorage.publicHost` → the install notes say uploads need it; an upload fails visibly in the dialog, never silently. — backend
- [ ] Set `postgresql.auth.password` to a new value after install, then upgrade → it fails as the README documents (auth error in the upgrade job) and `--atomic` rolls back. Recovery per the README (`ALTER ROLE`, then set the value) succeeds. — backend

Concurrency & races sit in §5 (a killed upgrade Job, two concurrent upgrades). The app's own write races are outside this change, which ships no app code beyond the image's version env.

**Findings**

| Probe | Observed | Severity | Disposition |
|---|---|---|---|
| §5 renamed bucket | Pod rolled and the identity followed (old bucket 403), but every write to `renamed-uploads` answered 500 "No writable volumes and no free volumes left": `weed server`'s default 8 slots were all taken (7 internal + 1 for the first bucket) | med | fixed-in-PR (322c43e9: slots from free disk at 512 MB volumes, `check-helm` scenario); re-walked: put/get/delete on the renamed bucket OK, 7 volumes grown |
| §3 ListBuckets with the app's keys | Allowed, but returns only `portalai-uploads` (SeaweedFS filters to buckets the identity can act on); CreateBucket/DeleteBucket denied 403 | — | expected-safe variant: nothing outside the bucket is disclosed |
| §5 disabled Keycloak user | Refresh refused (`invalid_grant`, "User disabled"), fresh sign-in refused; an access token issued before the disable keeps working until it expires (≤ 5 min, `exp − iat = 300`) | low | waived: inherent to stateless JWTs; the realm's 5-minute access-token lifetime bounds it |
| §6 DB password changed after install | Failed as documented (`password authentication failed for user "portalai"`), `--atomic` rolled back, app stayed ready; the hook's retries made the failure take ~3 min | — | expected (README limit); recovery per README verified |

**Sign-off**
- [ ] Every probe walked; findings fixed in-PR or waived with a reason — <date, name>

Bug template: Section · Probe · Expected (safe) · Got · Repro · Identifiers (release revision, pod/job names, user id).

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

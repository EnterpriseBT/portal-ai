# Residency web image supply-chain gate — Condensed design (#909)

**Issue:** [EnterpriseBT/portal-ai#909](https://github.com/EnterpriseBT/portal-ai/issues/909) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Each deploy pushes two images. The API image goes through #573's gate: Trivy scan before push, SBOM and provenance, cosign signature. The residency web image (#566) is pushed straight to ECR with `provenance: false`, yet customers mirror it from the Helm chart (`image.web`). This ticket gives the web image the same gate and removes the "known exception" from the docs that #615 added. The change touches the deploy workflows, `apps/web/Dockerfile` and the durable docs.

## Current shape

| Piece | Location | Note |
|---|---|---|
| API gate (the pattern) | `deploy-dev.yml` (`Build image (load, no push) for scanning` → `Scan image (gate…)` → `Build and push … (+ SBOM & provenance)` → `Sign image (cosign keyless)`) | Single platform `linux/arm64`, `load: true` then Trivy `CRITICAL,HIGH`, `ignore-unfixed`, `exit-code: 1` |
| Web image push | `deploy-dev.yml` and `deploy-prod.yml` `Build and push web image` | `platforms: linux/amd64,linux/arm64`, `push: true`, `provenance: false`, no scan, no sign |
| Web runtime stage | `apps/web/Dockerfile` | `nginxinc/nginx-unprivileged:1.27-alpine` + `apk add --no-cache nodejs` (for `render-config.mjs`); **no `apk upgrade`** |
| Docs naming the exception | `docs/SUPPLY_CHAIN.md` ("Known exception … (#909)"), `docs/DEPLOYMENT_SECURITY_REVIEW.md` §4 "Image provenance", `deploy/helm/portalai/README.md`, `docs/PROD_DEPLOY.runbook.md`, root `README.md` | All say "until #909" |

**Measured during discovery (local build, `aquasec/trivy:0.64.1`, the gate's flags):**
- The image as built today has **60 fixable CRITICAL/HIGH**, all Alpine 3.21.3 OS packages (`libcrypto3`, `curl`, `brotli-libs`, `c-ares`, …). Adding the gate alone would fail every deploy.
- With `apk upgrade --no-cache` in the runtime stage it has **0** (Alpine 3.21.9; nginx 1.27.5 and node 22.23.4 unchanged).

## Decision — gate both architectures, after the same minimization as the API image

- **Scan what ships.** The image is multi-arch. Buildx's `load` exporter takes one platform at a time, so the job builds and loads `linux/amd64`, scans it, then does the same for `linux/arm64` (QEMU is already set up in the job, and the push reuses the builder cache). Both must pass before anything is pushed. Scanning only the runner's architecture was rejected: customers pull either, and the gate's promise is the shipped artifact.
- **Minimize like #573.** Add `RUN apk upgrade --no-cache` to the web runtime stage (as root, before `USER nginx`), as the API Dockerfile does. That alone takes the image to 0 fixable findings. Keep the 1.27 base tag; a base-image bump is a separate decision.
- **Push and attest like the API:** `provenance: mode=max`, `sbom: true`, the same tags. Then `cosign sign` the pushed **index digest** (multi-arch manifest list), so one signature covers both architectures.
- **Docs:** `SUPPLY_CHAIN.md` covers both images with no exception, and the verify commands apply to both. The security review §4 row, the Helm README, `PROD_DEPLOY.runbook.md` and the root README drop their "until #909" wording.

## Plan — 2 slices

1. **Image + pipeline.**
   - **Files:**
     - `apps/web/Dockerfile`: `apk upgrade --no-cache` in the runtime stage.
     - `.github/workflows/deploy-dev.yml` and `deploy-prod.yml`: two `load: true` scan builds (amd64, arm64) plus two Trivy gate steps; the push step gains `provenance: mode=max` and `sbom: true` and an `id`; a `Sign web image (cosign keyless)` step on `steps.<id>.outputs.digest`.
   - **Tests:** `npm run lint:ci-cache` (workflow invariants, pinned runners); a local `docker build` of the web image, then Trivy with the gate's flags must report 0; `docker run` of the image serves `/` and `/config.js` (the entrypoint still renders config).
2. **Docs.**
   - **Files:** `docs/SUPPLY_CHAIN.md`, `docs/DEPLOYMENT_SECURITY_REVIEW.md` (§4 and the SaaS baseline), `deploy/helm/portalai/README.md`, `docs/PROD_DEPLOY.runbook.md`, `README.md`.
   - **Tests:** `npm run lint:doc-pointers`; `grep -rn "#909" docs deploy README.md` leaves only historical references.

## Smoke (manual, against your dev stack)

1. `docker build -f apps/web/Dockerfile --build-arg VITE_API_BASE_URL= -t portalai-web:smoke .`, then `docker run --rm -v /var/run/docker.sock:/var/run/docker.sock aquasec/trivy:0.64.1 image --scanners vuln --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 portalai-web:smoke`. Expected: exit 0, no findings.
2. `docker run --rm -p 8089:8080 -e AUTH_PROVIDER=auth0 portalai-web:smoke`; `curl -s localhost:8089/config.js` returns `window.__RUNTIME_CONFIG__ = …`, and `curl -s -o /dev/null -w '%{http_code}' localhost:8089/` returns `200`.
3. After merge, the `deploy-dev` run shows both web scan steps green **before** `Build and push web image`, and a `Sign web image` step.
4. `cosign verify --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity-regexp '^https://github.com/EnterpriseBT/portal-ai' <web ECR>:dev-<sha>` succeeds (needs AWS ECR read). `docker buildx imagetools inspect` shows SBOM and provenance attestations for **both** platforms.
5. Negative check (optional, local only): build from the old Dockerfile (without `apk upgrade`) and run step 1's scan. It exits 1 with the Alpine 3.21.3 findings, so the gate bites.

## Out of scope

- Bumping the nginx base image off 1.27 (it's EOL upstream). That's a runtime change with its own smoke, tracked in #918. The gate **won't** flag nginx CVEs: nginx comes from nginx.org's apk repo, outside Trivy's Alpine advisory data (found in code review).
- Enforcing signatures at pull time (admission control) — the same open item as #573.
- PR-time image builds; images are still built only at deploy.

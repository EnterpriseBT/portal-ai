# Supply-chain security — container images

How the Portals AI container images are scanned, attested, and signed, and how to verify them. This is a **durable reference** (no phase-doc suffix) — keep it in sync with `.github/workflows/deploy-dev.yml` and `deploy-prod.yml`. Introduced by #573.

## Which images

Each deploy's `deploy-backend` job builds and pushes **two** images:

| Image | Built from | Used by | Gated (this doc) |
|---|---|---|---|
| **API** | `apps/api/Dockerfile` | SaaS (ECS) and residency (Helm `image.api`) | **Yes** — every step below |
| **Web** | `apps/web/Dockerfile` | Residency only (Helm `image.web`, #566); SaaS serves the SPA from S3/CloudFront | **Yes** — every step below, for each platform it ships (#909) |

## What the deploy pipeline does

Both images are built only at deploy time (dev: push to `main` / manual dispatch; prod: release/tag). Each deploy runs, in order, inside the `deploy-backend` job:

1. **Build (load, no push)** — the image is built and loaded locally, not yet pushed. The API image ships one platform (`linux/arm64`). The web image ships two (`linux/amd64`, `linux/arm64`), and buildx loads one platform at a time, so each is built and loaded separately; both must pass step 2 before anything is pushed.
2. **Vulnerability gate** — Trivy scans the **whole image** (OS + language packages) and **fails the deploy** on any fixable `CRITICAL` or `HIGH` (`--severity CRITICAL,HIGH --ignore-unfixed --exit-code 1`). Nothing is pushed to ECR when the gate fails. `MEDIUM`/`LOW` and vulnerabilities with no fix available are reported but do not block.

   **The runtime images are minimized so a whole-image gate is viable.** For the API image, a full scan of the original image was dominated by tooling that the runtime never actually uses, so that tooling was removed (see `apps/api/Dockerfile`):
   - **`drizzle-kit` → `devDependencies`.** The production migrate path (`dist/scripts/db-migrate.js`) uses `drizzle-orm/postgres-js/migrator`, not `drizzle-kit` (it was deliberately moved off `drizzle-kit migrate`, which breaks after an RDS password rotation). `drizzle-kit` was the only prod dependency pulling the `esbuild` binaries, so moving it drops them from the image entirely.
   - **Bundled `npm`/`npx`/`corepack` deleted from the runtime layer.** The service and the one-off migrate/seed ECS tasks all run `node dist/...` directly (the task command overrides in the deploy workflows point at `node`, not `npm run`), so npm is never invoked at runtime; its bundled transitive deps (tar, pacote, …) went with it.
   - **OS packages** are patched at build time via `apk upgrade` in the runtime stage.

   The web image's runtime stage (`apps/web/Dockerfile`, the official `nginx` image + `nodejs` for the config renderer) runs `apk upgrade` too. The pinned base tag ships stale Alpine packages: 60 fixable CRITICAL/HIGH findings before the upgrade, 0 after (#909).

   **nginx is covered by the scan and by its own check (#918, #1096).** The official `nginx` image installs nginx from nginx.org's own apk repository. #918 found Trivy's Alpine advisory data didn't cover that package; since November 2026 it matches `nginx` by package name, so a fixed nginx CVE now **fails this gate** (#1096). The checks below stay, because the advisories list fixes before Trivy's data does, and the gate can't act until a fixed `-alpine-slim` image exists:
   - **Supported line, small surface.** The image runs the current **stable** line in its `-alpine-slim` variant, which ships nginx with no dynamic modules (no geoip, image-filter, njs or xslt).
   - **Our own base, our own hardening (#1096).** The base is the official `nginx` image, which nginx publishes within a day or so of a release. We used `nginxinc/nginx-unprivileged` until it went over a week without publishing a CVE-fixing release, which blocked every deploy. The Dockerfile now does what that image did: it drops `user` from `nginx.conf`, moves the pid and every temp path to `/tmp`, gives `/var/cache/nginx` and the served directory to uid 101, and ends on `USER 101`. `/etc/nginx/conf.d` stays root-owned, so the entrypoint's stock scripts can't rewrite the baked `default.conf`.
   - **Exact pin.** The tag names the exact version (`1.30.8-alpine-slim`), and the image is pinned by digest.
   - **Weekly advisory check.** `.github/workflows/nginx-advisories.yml` runs `scripts/nginx-advisories.mjs`. It checks that version against [nginx.org's security advisories](https://nginx.org/en/security_advisories.html) and the current stable release. When the pin is affected or stale, it opens or updates one issue, *nginx in the residency web image needs attention*, with each advisory, its fix version and its SLA (below). It comments when the findings change, since an edited body notifies nobody, and the first clean run closes the issue. A newer stable release only counts once its `-alpine-slim` image is published on the official `nginx` repository. An advisory nginx.org has said it won't fix is skipped only when the script's `WONT_FIX` list names its CVE, with a reason (today just CVE-2009-4487), so a new advisory with no fix yet is still reported. nginx.org dropped its Severity lines in November 2026, so an unrated advisory gets the strictest SLA, 7 days. The check fails closed: an unreadable pin or page, or an advisory whose affected versions it can't read, turns the run red and adds a comment saying so, leaving the last known advisory table in place. `npm run lint:nginx-advisories` self-tests the parser in Unit Tests.

   **Scanned = pushed.** Each platform is built in its own step before the push build, so the push must produce the same layers: the build args come from one step output shared by every build of an image, the builds share one builder's cache in one job, and the web base image is pinned by digest so a moving tag can't change the runtime layer in between.

3. **Push + attest** — the image is pushed to ECR with a **CycloneDX/SPDX SBOM** (`sbom: true`) and **SLSA build provenance** (`provenance: mode=max`) attached as OCI attestation manifests.
4. **Sign** — the pushed **digest** is signed with **cosign keyless** (GitHub Actions OIDC → Fulcio; no long-lived keys). Signing the digest (not the tag) makes the signature immutable. For the multi-arch web image that digest is the image index, so one signature covers both platforms. Signing runs through `.github/actions/cosign-sign`, which retries a failed sign up to 3 times with backoff: Sigstore occasionally drops a request mid-stream, and the first deploy after #909 failed that way between the push and the ECS update. Re-signing a digest is harmless.

`npm audit` (`.github/workflows/npm-audit.yml`) remains a **non-gating** visibility check (#545) — the image scan is the gate.

## Patch SLA

Remediate vulnerabilities that the gate reports (fixable, in either image) within:

| Severity | SLA |
|---|---|
| Critical | **7 days** |
| High | **30 days** |
| Medium / Low | Best-effort — next release |

A fixable Critical/High blocks the deploy on arrival, so the practical floor is "fixed before the next deploy." Unfixed (no upstream patch) vulnerabilities are tracked but do not block; re-evaluate them when a fix ships.

**nginx advisories** (the weekly check above, not the gate) use nginx.org's own ratings rather than CVSS:
- **major:** **7 days**.
- **medium / low / minor:** **30 days**. nginx rates memory-safety bugs such as buffer overflows *medium*, so these aren't left to best effort.
- **none:** ignored. nginx.org uses it for issues it won't fix.

The fix is a PR moving the web Dockerfile's runtime `FROM` to the fixed stable tag and its index digest, together. The deploy's gate then covers the rest of the image.

## Exceptions

When the gate fails on a fix that can't ship yet, typically a fixed nginx release whose `-alpine-slim` image isn't published (#1096), the gate can carry a **time-boxed exception**. It lives in `.github/actions/image-gate/trivyignore.yaml`, which the gate passes explicitly to Trivy. Every entry needs:
- **the CVE id**, exactly as Trivy reports it, never a pattern;
- **`purls`** scoping it to the package and version whose unreachability the statement argues, without qualifiers so it matches every platform (e.g. `pkg:apk/alpine/nginx@1.30.6-r1`). The gate is shared by both images, so an unscoped id would also hide that CVE in any other package;
- **a `statement`** with the tracking issue and the concrete reason the vulnerable code isn't reachable in what we ship (e.g. "nginx.conf enables no http2");
- **an `expired_at`** no later than the severity's SLA from detection (Critical 7 days, High 30 days).

Trivy reports an expired entry again, so an exception that outlives its fix fails the next deploy rather than staying ignored. A versioned purl also stops matching once the package moves off that version. The follow-up PR (usually the tag + digest bump) deletes the entries. Leave the file as `vulnerabilities: []` when nothing is excepted. An exception never covers a finding whose vulnerable code we do reach: that waits for the fix, or the deploy waits.

## Verifying a published image

Applies to both images: use the API or the web ECR repository URI for `<ECR_URI>`, and e.g. `dev-<sha>` / `prod-<sha>` for `<tag>`. For the web image, `imagetools inspect` lists an attestation manifest per platform.

**Signature (cosign keyless):**

```bash
cosign verify \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  --certificate-identity-regexp '^https://github.com/EnterpriseBT/portal-ai' \
  <ECR_URI>:<tag>
```

**SBOM + provenance attestations:**

```bash
# List the attestation manifests attached to the image
docker buildx imagetools inspect <ECR_URI>:<tag>

# Print the SBOM (buildx stores it as an attestation inside the image index,
# so `cosign download sbom` won't find it). For the multi-arch web image the
# result is a map keyed by platform.
docker buildx imagetools inspect <ECR_URI>:<tag> --format '{{ json .SBOM }}'

# Print the SLSA provenance the same way
docker buildx imagetools inspect <ECR_URI>:<tag> --format '{{ json .Provenance }}'
```

## Changing the policy

- **Severity threshold / ignore-unfixed / Trivy version** live in one place, the composite action `.github/actions/image-gate`, which both deploy workflows call for every image and platform.
- **Signing identity** is the GitHub workflow's OIDC identity; the `--certificate-identity-regexp` above must match the repo. If the repo or workflow path changes, update the verify command here.
- Enforcing signatures **at pull time** (ECS/admission control rejecting unsigned images) is not yet in place — see #573's out-of-scope notes.

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

   The web image's runtime stage (`apps/web/Dockerfile`, `nginx-unprivileged` + `nodejs` for the config renderer) runs `apk upgrade` too. The pinned base tag ships stale Alpine packages: 60 fixable CRITICAL/HIGH findings before the upgrade, 0 after (#909).

3. **Push + attest** — the image is pushed to ECR with a **CycloneDX/SPDX SBOM** (`sbom: true`) and **SLSA build provenance** (`provenance: mode=max`) attached as OCI attestation manifests.
4. **Sign** — the pushed **digest** is signed with **cosign keyless** (GitHub Actions OIDC → Fulcio; no long-lived keys). Signing the digest (not the tag) makes the signature immutable. For the multi-arch web image that digest is the image index, so one signature covers both platforms.

`npm audit` (`.github/workflows/npm-audit.yml`) remains a **non-gating** visibility check (#545) — the image scan is the gate.

## Patch SLA

Remediate vulnerabilities that the gate reports (fixable, in either image) within:

| Severity | SLA |
|---|---|
| Critical | **7 days** |
| High | **30 days** |
| Medium / Low | Best-effort — next release |

A fixable Critical/High blocks the deploy on arrival, so the practical floor is "fixed before the next deploy." Unfixed (no upstream patch) vulnerabilities are tracked but do not block; re-evaluate them when a fix ships.

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

# Pull the SBOM
cosign download sbom <ECR_URI>:<tag>
```

## Changing the policy

- **Severity threshold / ignore-unfixed** live in the `Scan image` step and the two `Scan web image (…)` steps of both deploy workflows — change them in all six.
- **Signing identity** is the GitHub workflow's OIDC identity; the `--certificate-identity-regexp` above must match the repo. If the repo or workflow path changes, update the verify command here.
- Enforcing signatures **at pull time** (ECS/admission control rejecting unsigned images) is not yet in place — see #573's out-of-scope notes.

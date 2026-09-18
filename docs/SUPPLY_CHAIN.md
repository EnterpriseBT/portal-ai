# Supply-chain security — API image

How the Portals AI API container image is scanned, attested, and signed, and how to verify it. This is a **durable reference** (no phase-doc suffix) — keep it in sync with `.github/workflows/deploy-dev.yml` and `deploy-prod.yml`. Introduced by #573.

## What the deploy pipeline does

The API image is built only at deploy time (dev: push to `main` / manual dispatch; prod: release/tag). Each deploy runs, in order, inside the `deploy-backend` job:

1. **Build (load, no push)** — the image is built and loaded locally, not yet pushed.
2. **Vulnerability gate** — Trivy scans the **whole image** (OS + language packages) and **fails the deploy** on any fixable `CRITICAL` or `HIGH` (`--severity CRITICAL,HIGH --ignore-unfixed --exit-code 1`). Nothing is pushed to ECR when the gate fails. `MEDIUM`/`LOW` and vulnerabilities with no fix available are reported but do not block.

   **The runtime image is minimized so a whole-image gate is viable.** A full scan of the original image was dominated by tooling that the runtime never actually uses, so that tooling was removed (see `apps/api/Dockerfile`):
   - **`drizzle-kit` → `devDependencies`.** The production migrate path (`dist/scripts/db-migrate.js`) uses `drizzle-orm/postgres-js/migrator`, not `drizzle-kit` (it was deliberately moved off `drizzle-kit migrate`, which breaks after an RDS password rotation). `drizzle-kit` was the only prod dependency pulling the `esbuild` binaries, so moving it drops them from the image entirely.
   - **Bundled `npm`/`npx`/`corepack` deleted from the runtime layer.** The service and the one-off migrate/seed ECS tasks all run `node dist/...` directly (the task command overrides in the deploy workflows point at `node`, not `npm run`), so npm is never invoked at runtime; its bundled transitive deps (tar, pacote, …) went with it.
   - **OS packages** are patched at build time via `apk upgrade` in the runtime stage.

   `npm audit` (`.github/workflows/npm-audit.yml`) remains a non-gating check for the **source** dependency tree; the image gate is what enforces the shipped artifact.
3. **Push + attest** — the image is pushed to ECR with a **CycloneDX/SPDX SBOM** (`sbom: true`) and **SLSA build provenance** (`provenance: mode=max`) attached as OCI attestation manifests.
4. **Sign** — the pushed **digest** is signed with **cosign keyless** (GitHub Actions OIDC → Fulcio; no long-lived keys). Signing the digest (not the tag) makes the signature immutable.

`npm audit` (`.github/workflows/npm-audit.yml`) remains a **non-gating** visibility check (#545) — the image scan is the gate.

## Patch SLA

Remediate vulnerabilities that the gate reports (fixable, in the API image) within:

| Severity | SLA |
|---|---|
| Critical | **7 days** |
| High | **30 days** |
| Medium / Low | Best-effort — next release |

A fixable Critical/High blocks the deploy on arrival, so the practical floor is "fixed before the next deploy." Unfixed (no upstream patch) vulnerabilities are tracked but do not block; re-evaluate them when a fix ships.

## Verifying a published image

Replace `<ECR_URI>` with the repository URI and `<tag>` with e.g. `dev-<sha>` / `prod-<sha>`.

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

- **Severity threshold / ignore-unfixed** live in the `Scan image` step of both deploy workflows — change them in both.
- **Signing identity** is the GitHub workflow's OIDC identity; the `--certificate-identity-regexp` above must match the repo. If the repo or workflow path changes, update the verify command here.
- Enforcing signatures **at pull time** (ECS/admission control rejecting unsigned images) is not yet in place — see #573's out-of-scope notes.

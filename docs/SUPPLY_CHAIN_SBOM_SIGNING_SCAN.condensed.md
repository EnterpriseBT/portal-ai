# Supply-chain: SBOM + image signing + gating scan — Condensed design (#573)

**Issue:** [EnterpriseBT/portal-ai#573](https://github.com/EnterpriseBT/portal-ai/issues/573) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic [#578](https://github.com/EnterpriseBT/portal-ai/issues/578) — branches off `epic/security-readiness`.

**Why.** Supply-chain hardening the SaaS wants now and marketplace review requires: today `npm audit` is non-gating (#545), there is no SBOM, and images are unsigned (`provenance: false`). Add an SBOM + build provenance, cosign signing, and a **blocking** deploy-time image vuln scan. CI/pipeline only — no app code. Changes live in the two API-image deploy workflows plus a short supply-chain doc.

## Current shape

| Piece | Location | Note |
|---|---|---|
| API image build (dev) | `.github/workflows/deploy-dev.yml:401-415` | `docker/build-push-action@v6`, `platforms: linux/arm64`, `push: true`, `provenance: false`; tags `dev-<sha>` + `latest` |
| API image build (prod) | `.github/workflows/deploy-prod.yml:375-386` | same action, `platforms: linux/arm64`, `push: true`, `provenance: false`; tag `prod-<sha>` (no `latest`) |
| Buildx / QEMU setup | both, just above the build step | `setup-qemu-action@v3` + `setup-buildx-action@v3` already present |
| npm audit | `.github/workflows/npm-audit.yml` | Deliberately **non-gating** (#545 — visibility, never fails). **Unchanged** by this ticket. |
| Image build timing | deploy workflows only | Built at **deploy** (dev: push to `main`/dispatch; prod: release/tag). **No PR-time image build** — the gate runs at deploy, by design. |

## Decision — deploy-time scan-before-push, buildx attestations, cosign keyless

Both deploy workflows change their single build step into a **build → scan → push+attest → sign** sequence (single arch makes `load` + scan straightforward):

1. **Build, no push** — `docker/build-push-action@v6` with `load: true, push: false` (buildx cache populated).
2. **Scan (gate)** — `aquasecurity/trivy-action` against the loaded image: `--severity CRITICAL,HIGH --ignore-unfixed --exit-code 1` over the **whole image** (OS + language packages). A fixable CRITICAL/HIGH fails the job **before anything is pushed**. MEDIUM/LOW + unfixed reported, non-blocking. **The runtime image is minimized so the whole-image gate passes cleanly** — the smoke found the original image's ~60 findings were all base-image/build tooling the runtime never uses, so it was removed (see Files): `drizzle-kit` → devDep (drops the `esbuild` binaries; the prod migrate uses `drizzle-orm`'s migrator, not drizzle-kit), and bundled `npm`/`npx`/`corepack` deleted (the migrate/seed tasks run `node dist/...` directly). OS layer patched via `apk upgrade`. `npm audit` stays the non-gating **source**-tree check.
3. **Push + attest** — second `build-push-action` with `push: true`, **`provenance: mode=max`**, **`sbom: true`** — reuses the buildx cache (no recompile), attaches SPDX SBOM + SLSA provenance to the ECR manifest. Capture `outputs.digest`.
4. **Sign** — `cosign sign --yes <ECR_URI>@<digest>` **keyless** (GitHub OIDC → Fulcio); job gets `permissions: id-token: write`. No key material.

**Why this shape (vs. alternatives):** scanning a *pushed* image and rolling back leaves an unsigned/unscanned artifact in ECR; scanning first keeps ECR clean. `--ignore-unfixed` keeps the gate actionable (an unpatchable base-image CVE can't wedge a deploy). Keyless signing avoids a KMS key + rotation. `npm audit` stays non-gating — re-litigating #545 is out of scope and image scanning catches base-image OS CVEs `npm audit` can't see.

**Documented patch SLA:** Critical **7 days**, High **30 days**, Medium/Low best-effort / next release — recorded in `docs/SUPPLY_CHAIN.md` (durable, unsuffixed) next to how to verify a signature and pull the SBOM.

## Plan — 1 slice (one PR; changes are cohesive)

**Files:**
- `.github/workflows/deploy-dev.yml` & `.github/workflows/deploy-prod.yml` (edit) — replace the one build step with the 4-step sequence above; `id-token: write` is already on the `deploy-backend` job (AWS OIDC); add `sigstore/cosign-installer@v4.1.2` + `aquasecurity/trivy-action@v0.36.0`. Prod keeps no `latest`.
- `apps/api/Dockerfile` (edit) — `apk upgrade --no-cache` (patch OS) and `rm -rf` the bundled `npm`/`npx`/`corepack` from the runtime layer.
- `apps/api/package.json` (edit) — move `drizzle-kit` to `devDependencies` (drops `esbuild` from the runtime image).
- `.github/workflows/deploy-{dev,prod}.yml` (edit) — the one-off migrate/seed ECS task commands change from `["npm","run","db:migrate:ci"]` / `db:seed:ci` to `["node","dist/scripts/db-migrate.js"]` / `["node","dist/db/seed.js"]` so the image needs no npm.
- `docs/SUPPLY_CHAIN.md` (new, **durable/unsuffixed**) — the gate policy, severity threshold, patch SLA, and the `cosign verify` / SBOM-download runbook.
- `CLAUDE.md` (edit) — one line under CI gating noting images are signed + SBOM-attested and the scan is a deploy gate (keep docs in sync).

**Tests:** No unit/integration harness covers workflow YAML. Verification is the smoke below: a local Trivy scan proving the gate command + threshold behave, workflow validity, and a post-deploy `cosign verify` / SBOM fetch. (Assert-nothing in Jest for CI YAML — matches the repo's no-plan-guard discipline.)

## Smoke (manual, against your dev stack + first deploy)

Agent-walkable locally:
1. **Build the image** (arm64, matching deploy): `docker buildx build --platform linux/arm64 -f apps/api/Dockerfile -t portalai-api:scan --load .`
2. **Run the exact gate command (whole image):** `trivy image --severity CRITICAL,HIGH --ignore-unfixed --exit-code 1 portalai-api:scan` → exits 0 (all targets 0 vulns after the tooling removal + `apk upgrade`).
3. **Migrate/seed/boot still work npm-free:** `docker run --rm --network <compose-net> --env-file apps/api/.env portalai-api:scan node dist/scripts/db-migrate.js` (and `node dist/db/seed.js`) succeed; the container boots and `/api/health` returns 200 as the non-root `node` user.
4. **SBOM generates:** `trivy image --format spdx-json --output sbom.json portalai-api:scan` produces a non-empty SPDX doc.

Manual-only (needs the real deploy — AWS OIDC + ECR, runs after the epic reaches `main`):
5. **Attestations present:** after a dev deploy, `docker buildx imagetools inspect <ECR_URI>:dev-<sha>` shows provenance + SBOM attestation manifests.
6. **Signature verifies:** `cosign verify --certificate-oidc-issuer https://token.actions.githubusercontent.com --certificate-identity-regexp '^https://github.com/EnterpriseBT/portal-ai' <ECR_URI>@<digest>` succeeds.
7. **Gate actually blocks:** a deploy with a seeded fixable CRITICAL fails the job before push (verify once by inspection or a throwaway run), leaving ECS on the prior image.

## Out of scope

- Promoting `npm audit` to gating / re-opening #545 — the image scan is the gate; dependency-audit policy is unchanged.
- Signing the **web/site** static artifacts and the marketing-site image — this ticket is the API image; other artifacts are their own follow-ups.
- A per-PR image build+scan (earliest-feedback option) — deliberately not taken to avoid adding a Docker build to every PR; the deploy-time gate is the agreed scope.
- Admission-time signature **verification** at pull (e.g. ECS/Kyverno enforcing only-signed-images) — signing is produced here; enforcing it at deploy is a later hardening step.

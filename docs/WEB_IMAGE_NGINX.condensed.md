# Web image on a supported nginx, with tracked nginx CVEs — Condensed design (#918)

**Issue:** [EnterpriseBT/portal-ai#918](https://github.com/EnterpriseBT/portal-ai/issues/918) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** The residency web image runs `nginxinc/nginx-unprivileged:1.27-alpine` (nginx 1.27.5). The 1.27 line is end of life, and the #909 Trivy gate can't see the nginx binary, because nginx comes from nginx.org's apk repository, which Trivy's Alpine data doesn't cover. This is already a live gap: nginx.org lists CVE-2026-15176 (medium) as affecting 0.1.29–1.31.6, which includes the pinned 1.27.5. This ticket moves the image to the supported stable line without modules, and adds a check of the pinned version against nginx.org's advisories. It changes `apps/web/Dockerfile`, a new workflow plus script, and docs. The chart's contract (uid 101, port 8080, probes on `/`) doesn't change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Runtime base | `apps/web/Dockerfile:61` | `1.27-alpine@sha256:65e3e85d…`, digest-pinned since #909 |
| OS patching + node | `apps/web/Dockerfile:68-70` | `apk upgrade` + `nodejs` for `render-config.mjs` |
| Startup config | `apps/web/scripts/40-render-config.sh` | Sourced from `/docker-entrypoint.d/` before nginx starts |
| Server config | `apps/web/nginx.conf` | Core directives only (`listen`, `try_files`, `add_header`); uses no module |
| Chart probes | `deploy/helm/portalai/templates/web-deployment.yaml:49-60` | `httpGet /` on port `http` (8080) |
| Caveat text | `docs/SUPPLY_CHAIN.md:28`, `deploy/helm/portalai/README.md:179-180`, `CLAUDE.md` supply-chain section | "The gate doesn't see nginx itself" |
| Issue-on-drift pattern | `.github/workflows/refresh-integration-durations.yml` | Weekly job that opens or updates one issue (`issues: write`, pushes nothing) |
| Self-tested script pattern | `package.json` `lint:integration-skip` / `lint:integration-shards` | `node scripts/<x>.mjs --self-test`, run in CI |

Upstream, as of 2026-10-29: stable is **1.30** (`1.30.6-alpine-slim`, index digest `sha256:5d8bb9437d74…`), and mainline is 1.31. The `-slim` variants ship nginx with no dynamic modules (no geoip, image-filter, njs or xslt). nginx.org's advisory page lists each advisory with `Severity:`, `Not vulnerable: 1.31.7+, 1.30.6+` and `Vulnerable: <a>-<b>[, …]`.

## Decision 1 — base: `1.30.6-alpine-slim`, digest-pinned

- **Stable, not mainline.** Stable only takes fixes, which is the right line for a binary we can't scan.
- **Slim drops the four modules.** Our config loads none of them, and none of their code ships at all, so this needs no `apk del` against the base's packages.
- **The tag names the patch** (`1.30.6`), so the Dockerfile states the exact nginx version the check reads. The digest pins the layers, as before (#909). Bump the tag and the digest together.
- `apk upgrade` + `nodejs`, `USER nginx`, the entrypoint script and the 8080/uid 101 contract stay as they are.

## Decision 2 — tracking: a weekly advisory check that opens one issue

- **Rejected: Dependabot or Renovate on the base digest.** Neither exists in this repo. Both track *versions*, not advisories, so they would propose a mainline 1.31 bump by default. They also say nothing about whether the pinned build is affected.
- **Rejected: a deploy-time check.** It would put nginx.org's availability in the deploy's path. The Trivy gate stays the only deploy-time blocker.
- **Chosen:**
  - `scripts/nginx-advisories.mjs` reads the pinned version from the Dockerfile's `FROM` and parses nginx.org's `security_advisories.html`. It reports every advisory whose `Vulnerable` ranges include that version, and whether a newer patch or a newer stable line exists.
  - `.github/workflows/nginx-advisories.yml` runs it weekly (plus `workflow_dispatch`) and opens or updates one issue when the pin is affected or stale. It follows refresh-integration-durations' pattern: `issues: write` only, pushes nothing, pinned runner.
  - **Fail closed:** a missing pin or an unparseable page fails the run, and the issue then says the check couldn't run, so a broken parser never reads as "clean".
  - `npm run lint:nginx-advisories` self-tests the parser against embedded fixtures, including the real two-advisory shape above, and runs in `unit-test.yml`.
- **SLA,** recorded in `SUPPLY_CHAIN.md`: nginx rates advisories major/medium/low rather than CVSS. Major maps to Critical (7d) and medium/low to High (30d).

## Plan — 2 slices

1. **Base move.**
   - **Files:** `apps/web/Dockerfile` (FROM + comment).
   - **Tests:**
     - Build both platforms locally (`docker buildx build --platform linux/amd64,linux/arm64`).
     - Trivy (the image-gate settings) on the amd64 image: 0 fixable CRITICAL/HIGH.
     - `nginx -V` shows 1.30.6, and `ls /etc/nginx/modules` is empty or absent.
     - Run the container and `curl` `/`, `/config.js` and a deep route: 200, as uid 101 on 8080.
2. **Advisory tracking + docs.**
   - **Files:**
     - New: `scripts/nginx-advisories.mjs`, `.github/workflows/nginx-advisories.yml`.
     - Edit: `package.json` (`lint:nginx-advisories`), `unit-test.yml` (run it).
     - Docs: `docs/SUPPLY_CHAIN.md` (replace the caveat with the tracking + SLA), `deploy/helm/portalai/README.md:179`, the `CLAUDE.md` supply-chain paragraph.
   - **Tests:**
     - `npm run lint:nginx-advisories`: the self-test passes.
     - `node scripts/nginx-advisories.mjs` live: 1.30.6 reports clean, and pointing it at 1.27.5 reports CVE-2026-15176.
     - `npm run lint:ci-cache` (pinned runner) and `lint:doc-pointers` pass.

## Smoke (manual, against your dev stack)

1. Locally, `docker build -f apps/web/Dockerfile -t web-918 .`, then `docker run --rm -p 8080:8080 web-918`. `curl -i localhost:8080/` returns 200 with `Cache-Control: no-cache`; `/config.js` returns 200 with `no-store`; `/stations/x` returns `index.html`. `docker exec <id> id -u` prints `101`.
2. `docker run --rm web-918 nginx -V` prints `nginx/1.30.6` and lists no `--add-dynamic-module`.
3. `node scripts/nginx-advisories.mjs` reports the pin as current with no advisories. `node scripts/nginx-advisories.mjs --version 1.27.5` lists CVE-2026-15176 and exits non-zero.
4. After merge (GitHub only dispatches a workflow that exists on the default branch): `gh workflow run nginx-advisories.yml --repo EnterpriseBT/portal-ai`. The run is green and opens no issue.
5. After merge: the `deploy-dev` image gate passes on both platforms, and the residency web image is pushed and signed.

## Out of scope

- Replacing nginx with another server.
- A deploy-time advisory check (Decision 2).
- Version-bump automation (Dependabot/Renovate) for other images or dependencies.

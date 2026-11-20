# Web image gate: time-boxed nginx CVE exception — Condensed design (#1096)

**Issue:** [EnterpriseBT/portal-ai#1096](https://github.com/EnterpriseBT/portal-ai/issues/1096) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** Since 2026-11-19 17:17 every `deploy-dev` has failed at the web image's Trivy gate. It finds six fixable CRITICAL/HIGH CVEs in nginx 1.30.6-r1.
- **The fix exists:** nginx 1.30.7 (18 Nov) fixes all six.
- **The image doesn't:** `nginxinc/nginx-unprivileged:1.30.7-alpine-slim` isn't published, so the usual fix, a tag + digest bump, can't land yet.
- **Real exposure looks nil:** each CVE needs a feature `apps/web/nginx.conf` doesn't enable.

The change gives the gate a reasoned, expiring exception and corrects the docs that said nginx was invisible to the scan. It touches only CI and docs.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The gate | `.github/actions/image-gate/action.yml` | `trivy-action@v0.36.0`: CRITICAL,HIGH, `ignore-unfixed`, `exit-code: 1`, no ignore file |
| Web base | `apps/web/Dockerfile:66` | `nginx-unprivileged:1.30.6-alpine-slim@sha256:5d8b…` |
| nginx config | `apps/web/nginx.conf` | `listen 8080;` plain HTTP/1.1, `try_files` only; no http2, http3, mail, resolver or alias |
| Docs | `docs/SUPPLY_CHAIN.md` §nginx, `CLAUDE.md` supply-chain paragraph | Say Trivy can't see nginx (#918); that's no longer true |

## Decision — a time-boxed exception, not a weaker gate

Options:
- **Wait for the image:** app-dev stays undeployed for days.
- **Install 1.30.7 from nginx.org's apk repo:** changes how the image is built, only to revert it later.
- **Exception for exactly these six ids:** the user chose this.

**Shape:**
- **The file:** `.github/actions/image-gate/trivyignore.yaml`, passed explicitly via `trivyignores`, so a stray root `.trivyignore` can't widen the gate.
- **Each entry:**
  - the CVE id, scoped with `purls: [pkg:apk/alpine/nginx@1.30.6-r1]`, since the gate is shared by both images (verified to match without qualifiers, while a zlib-scoped control isn't ignored);
  - a `statement` with #1096 and the listener or block the baked `nginx.conf` lacks;
  - `expired_at: 2026-11-26` (the 7-day Critical SLA from 2026-11-19).
- **Expiry:** Trivy reports an expired entry again, so a forgotten follow-up fails the next deploy.
- **Docs:** `SUPPLY_CHAIN.md` gains an **Exceptions** policy and a corrected nginx paragraph; `CLAUDE.md` follows.

## Plan — 1 slice

**Files:**
- new: `.github/actions/image-gate/trivyignore.yaml`
- edit: `.github/actions/image-gate/action.yml` (the `trivyignores` input and a comment)
- edit: `docs/SUPPLY_CHAIN.md`, `CLAUDE.md`
- edit (code review): the comments in `apps/web/Dockerfile`, `scripts/nginx-advisories.mjs` and `.github/workflows/nginx-advisories.yml`, plus `deploy/helm/portalai/README.md` (the residency review records the shipped exceptions). None still says the gate can't see nginx.

**Tests:**
- There's no unit surface; the gate runs only at deploy.
- **Verified locally** with `aquasec/trivy:0.70.0` (the gate's version) against the pinned base image:
  - without the file: 9 CRITICAL/HIGH, including all six nginx CVEs;
  - with it: no nginx findings, leaving 3 base-Alpine findings (musl, zlib) that the Dockerfile's `apk upgrade` already removes in our image;
  - an entry with a past `expired_at` is reported again, in both the text and YAML formats.
- `npm run lint:ci-cache`, `lint:doc-pointers` and `lint:review-chain` pass.

**Follow-up (stays on #1096):** when `1.30.7-alpine-slim` publishes:
- bump `apps/web/Dockerfile:66`'s tag and digest together;
- reset the file to `vulnerabilities: []`;
- then close #1096.

## Smoke (manual, against CI after merge)

1. **The gate:** the `deploy-dev` run for the merge commit passes **Gate web image (linux/amd64)** and **(linux/arm64)**. The Trivy step logs "Using YAML ignorefile '.github/actions/image-gate/trivyignore.yaml'", and its table has no nginx rows. — backend
2. **The deploy:** `deploy-backend` pushes and signs the web image, and `verify-login` passes, so app-dev is deployed again. — backend
3. **The API image:** its gate is unchanged, and none of the six ids appear in its scan. — backend

## Out of scope

- Moving to nginx mainline (1.31.x): the image runs the stable line on purpose.
- Changing `nginx-advisories.yml`. It already flags a fixed release once its image exists, and its next weekly run (2026-11-23) will open the tracking issue if the image is still missing.

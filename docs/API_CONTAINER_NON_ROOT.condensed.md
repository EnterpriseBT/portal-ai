# Run the API container as non-root — Condensed design (#571)

**Issue:** [EnterpriseBT/portal-ai#571](https://github.com/EnterpriseBT/portal-ai/issues/571) · Feature · **small / condensed** (discovery + spec + plan + smoke in one doc). Child of epic [#578](https://github.com/EnterpriseBT/portal-ai/issues/578) — branches off `epic/security-readiness`.

**Why.** The production image (`apps/api/Dockerfile`) never sets a `USER`, so the runtime process runs as **root** — a marketplace image-scanner finding and a basic hardening gap in today's SaaS. Adding a non-root `USER` closes it. Single package (`apps/api`), one file, no new pattern, no contract change.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Runtime stage | `apps/api/Dockerfile:47-84` | `FROM node:22-alpine AS runtime`; no `USER` → root |
| `apk add` (root-only) | `apps/api/Dockerfile:53` | Installs `curl` + `postgresql-client`; must stay before the user switch |
| COPYs into `/app` | `apps/api/Dockerfile:56-77` | `dist`, `drizzle`, `node_modules`, core/spreadsheet dist — all world-readable (0644/0755) |
| Healthcheck / CMD | `apps/api/Dockerfile:81-84` | `curl` health probe + `node dist/index.js` — both fine as non-root |
| Migration path (prod) | `deploy-dev.yml:455`, `deploy-prod.yml:476` | One-off ECS task overrides command → `npm run db:migrate:ci` (= `node dist/scripts/db-migrate.js`) on the **same image** |
| Base image user | `node:22-alpine` (official) | Ships a `node` user, uid/gid **1000** — no `adduser` needed |

## Decision — reuse the base image's `node` user, no `chown`

- **A. `USER node` (uid 1000), no chown** — the official Node image already provides it. The app writes nothing into `/app` at runtime (no multer `diskStorage`, no `os.tmpdir()`/`writeFile` in the request path; `spreadsheet-parsing` parses in-memory; blobs live in S3), and read-only access to root-owned world-readable files needs no ownership change. Migrations only read `./drizzle` + hit the DB — also fine as `node`.
- **B. Dedicated `adduser -S portalai` + `chown -R`** — more Dockerfile, extra layers, and a `chown -R` of `node_modules` is a large slow layer. No benefit over the vetted `node` user for a workload that never writes to disk.

**Chosen: A.** One line, no ownership churn, uses the image's intended non-root uid. If a future ticket introduces a runtime scratch dir, that ticket adds a `chown`ed volume/dir — not this one.

## Plan — 1 slice

**Files (edit):** `apps/api/Dockerfile` — add `USER node` in the runtime stage, placed **after** the last COPY (line 77) and **after** `RUN apk add` (needs root), immediately before `EXPOSE`/`HEALTHCHECK`/`CMD`.

**Tests:** No unit test harness covers the Dockerfile; verification is the smoke walk below (build + `docker run` + `id` + health). CI's Static Checks (`build`/`type-check`/`lint`) are unaffected — they don't build the image; the image builds only at deploy.

## Smoke (manual, against your dev stack)

Run from `/workspace` (Docker available in the devcontainer):

1. **Build the runtime image:**
   `docker build -f apps/api/Dockerfile -t portalai-api:nonroot .`
2. **Confirm the default user is non-root:**
   `docker run --rm --entrypoint sh portalai-api:nonroot -c 'id'` → expect `uid=1000(node) gid=1000(node)`, **not** `uid=0(root)`.
3. **Boot + health:** run the container with the app's required env (point `DATABASE_URL` at your dev Postgres), then `curl -f http://localhost:3001/api/health` returns 200. Confirm the process inside runs as `node`: `docker exec <id> ps -o user,pid,args` shows the `node dist/index.js` process owned by `node`.
4. **Migrations still run as non-root:** `docker run --rm -e DATABASE_URL=... --entrypoint sh portalai-api:nonroot -c 'whoami && npm run db:migrate:ci'` → runs as `node` and applies/reports migrations without a permission error.
5. **Post-merge (app-dev):** after the epic reaches `main` and deploy-dev runs, confirm the ECS task and the one-off migrate task both come up green and `/api/health` passes.

## Out of scope

- Any other Dockerfile in the monorepo (web/site are static builds; only `apps/api` runs a long-lived server process). — deferred to their own tickets if ever needed.
- A read-only root filesystem, dropped Linux capabilities, or seccomp profile — deeper container hardening beyond the non-root uid this ticket targets.
- Task-definition / Helm security context (`runAsNonRoot`, `runAsUser`) — that's deployment-manifest work owned by the Enterprise Deployment epic (#566 Helm chart), which *inherits* this image change.

# Raise Node and unpin astro — Condensed design (#900)

**Issue:** [EnterpriseBT/portal-ai#900](https://github.com/EnterpriseBT/portal-ai/issues/900) · Task · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** #896 pinned `astro` to `~7.3.8` because 7.4 needs Node ≥ 22.23.4 and CI ran 22.23.3. The pin blocks every future Astro/Vite security fix, which is the opposite of #896's goal. The cause is how Node is chosen, not astro: CI asks for "22" and gets whatever the runner has cached, the devcontainer floats on `node:latest` (25 here), which is why local passed while CI failed, and the root `engines` still claims Node 18. This ticket makes the Node floor explicit everywhere, then takes astro back to a caret range. It touches CI, the devcontainer, the root and site manifests, and the demo-toolpack Lambda.

## Current shape

| Piece | Location | Note |
|---|---|---|
| Shared CI setup | `.github/actions/setup/action.yml:5`, `:39-41` | `node-version` default `"22"`; `setup-node` uses the runner's cached 22.x (22.23.3) unless told to check |
| Audit workflow | `.github/workflows/npm-audit.yml:53-55` | Its own `setup-node`, `"22"` |
| Demo-toolpack bundle | `.github/workflows/deploy-dev.yml:138-140` | `node-version: 20`, then `npm ci` over the whole lockfile |
| Demo-toolpack Lambda | `infra/cloudformation/demo-toolpack.yml:60` | `Runtime: nodejs20.x`; Node 20 is past end of life |
| Devcontainer | `Dockerfile:1` | `FROM node:latest`: a different major from CI and the images |
| API / web images | `apps/api/Dockerfile:2,36,48`, `apps/web/Dockerfile:12` | `node:22-alpine`, floating; a rebuild already gets 22.23.4+ |
| Root engines | `package.json:49-50` | `"node": ">=18.0.0"`; the tree needs ≥ 22.19 (`undici@8`), ≥ 22.22.1 (`lint-staged` 17), and ≥ 22.23.4 once astro moves |
| Astro pin | `apps/site/package.json:24` | `"astro": "~7.3.8"`; latest is 7.4.3 (`node >=22.23.4`) |

Current releases (nodejs.org, 2026-10-28): 22.23.4 (Jod, maintenance LTS), 24.22.1 (Krypton, active LTS), 26.12.1 (current).

## Decision — stay on Node 22, make it the newest 22 everywhere, and say so in `engines`

- **Options:**
  - (a) Move everything to Node 24 LTS. That's a major-version change to the API runtime image. The issue's sizing reserves it for a full ticket, with native-dependency and runtime testing this one doesn't do.
  - (b) Stay on 22 and pin an exact version (`22.23.4`). It stops the drift, but goes stale with each patch release and needs a bump PR for every Node security release.
  - (c) Stay on 22 and resolve the newest 22.x everywhere: `check-latest: true` on `setup-node`, `node:22` for the devcontainer, and the floating `node:22-alpine` images unchanged.
- **Chosen: (c).** It fixes the actual failure (a stale cached 22.x) and picks up Node security patches automatically, without a runtime major change. Moving to Node 24 is out of scope below.
  - `.github/actions/setup/action.yml` and `npm-audit.yml`: `check-latest: true`. The node_modules cache key keeps the major (`node22`), and native modules are ABI-stable within a major.
  - `deploy-dev.yml` demo-toolpack step: Node 20 → `"22"` with `check-latest: true`. Its `npm ci` installs the whole monorepo lockfile, which needs 22.
  - `infra/cloudformation/demo-toolpack.yml`: `nodejs20.x` → `nodejs22.x`. The handler has no dependencies, and 20 is end of life. It deploys with deploy-infra on the next push to main.
  - `Dockerfile` (devcontainer): `node:latest` → `node:22`, so local runs the same major as CI and the images. A newer local Node is how #896's failure passed locally.
  - Root `engines.node`: `>=22.23.4`, the tree's real floor once astro moves. Workspace CLIs keep their own `>=20`, which describes the package itself.
  - `apps/site/package.json`: `astro` `~7.3.8` → `^7.4.3`; `npm install`, then `npm audit` with no new site findings.

## Plan — 1 slice

**Files:** `.github/actions/setup/action.yml`, `.github/workflows/npm-audit.yml`, `.github/workflows/deploy-dev.yml`, `infra/cloudformation/demo-toolpack.yml`, `Dockerfile`, `package.json`, `apps/site/package.json`, `package-lock.json`. (Neither `README.md` nor `docs/LOCAL_DEVELOPMENT.md` names a Node version, so there's no doc drift to fix.)

**Tests:**
- `npm run build --workspace @portalai/site` and `npm run type-check --workspace @portalai/site` on astro 7.4.
- `npm run lint:ci-cache` (the setup action and workflows change).
- `npm audit`: no new high or critical findings.
- CI on the branch is the main check: Static Checks builds the site on the newest 22.x. The job log's "Setup Node.js" step must show 22.23.4 or later.

## Smoke (manual, against your dev stack)

1. CI on the PR: the Static Checks log shows Node ≥ 22.23.4, and the site builds with astro 7.4.x.
2. Rebuild the devcontainer (`Dev Containers: Rebuild Container`). `node -v` prints v22.x ≥ 22.23.4, and `npm run dev` brings up web :3000 and the API :3001 as before.
3. `npm run build --workspace @portalai/site` passes, and `npm run dev --workspace @portalai/site` serves http://localhost:3002.
4. After merge: deploy-dev's demo-toolpack step runs on Node 22, and `aws lambda get-function-configuration --function-name portalai-demo-toolpack` reports `nodejs22.x`. A registered demo toolpack call still succeeds. — manual

## Out of scope

- **Node 24 LTS.** A runtime major change for the API image deserves its own full ticket, ahead of 22's end of life (April 2027).
- **Pinning image digests** for `node:22-alpine`: the Trivy gate (#573) covers the shipped image.
- **Workspace CLI `engines`** (`>=20`): they describe each package, not the monorepo install.

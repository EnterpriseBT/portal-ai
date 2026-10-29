# Portals AI

A Turborepo monorepo for displaying dynamic UI content from a Model-Controller-Presenter architecture.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Material UI, TanStack Router/Query, Auth0
- **Public site**: Astro (static), no client framework — see [`apps/site/README.md`](apps/site/README.md)
- **Backend**: Node.js, Express, TypeScript, Drizzle ORM, PostgreSQL, Auth0 JWT
- **Shared**: Zod domain models, MUI component library
- **Tooling**: Turborepo, ESLint, Prettier, Jest, Storybook

## Monorepo Structure

```
apps/
  web/                  → React frontend (localhost:3000)
  api/                  → Express API server (localhost:3001)
  site/                 → Astro public marketing site (localhost:3002)
packages/
  core/                 → Shared UI components, themes, and Zod domain models
  spreadsheet-parsing/  → Workbook layout interpretation + replay
  cli-env/              → CLI environment-access layer (env registry, AWS/Auth0 auth)
  devops-cli/           → `portalops` — infrastructure operator CLI
  admin-cli/            → `portalai` — customer-app-data operator CLI
  e2e/                  → Playwright harness: CI specs, post-deploy login check, agent browser sessions
  demo-toolpack/        → Deployable reference custom toolpack (AWS Lambda) used by the demo org
```

### UI smoke walks & agent browser sessions

An in-container Claude session can drive a real browser against the running dev stack (navigate, click, screenshot, read console/network) to walk a ticket's smoke checklist or troubleshoot the live UI — via the Playwright MCP server (`.mcp.json`) and the `@portalai/e2e` harness. One-time setup (test-user auth → reusable session, seeded fixture org) and usage are in [`packages/e2e/README.md`](packages/e2e/README.md); the `/smoke-walk` skill runs a checklist and produces a per-step evidence report. Automated specs run in CI on every push (`E2E Tests`, `.github/workflows/e2e-test.yml`), and each deploy ends with a `verify-login` check (#489).

## Getting Started

### Prerequisites

- Node.js 22, at least 22.23.4 (`engines.node`; `npm install` refuses an older one)
- npm 10+
- PostgreSQL with PostGIS, and Redis, for the API

The devcontainer (`.devcontainer/`) provides all of these, with Postgres and Redis on the compose network; see [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md). Without it, run them yourself.

### Setup

```bash
# Install dependencies
npm install

# Build all packages (required on first run)
npm run build

# Start all dev servers
npm run dev
```

For the local inner-loop — Stripe webhook forwarding, the mock toolpack server, and the ngrok tunnel — see [`docs/LOCAL_DEVELOPMENT.md`](docs/LOCAL_DEVELOPMENT.md).

### Environment Variables

Copy `.env.example` to `.env` in each app directory:

- `apps/web/.env` — Auth0 client config (`VITE_AUTH0_*`) and the other `VITE_*` build values
- `apps/api/.env` — Auth0 API config, database and Redis URLs, CORS settings, provider keys
- `packages/admin-cli/.env` / `packages/devops-cli/.env` — `DATABASE_URL` (and `AUTH0_*` for `portalai login`) for `--env local`; each CLI auto-loads its own (#632)
- `packages/e2e/.env` — the browser harness's test identity (see its README)

`apps/site` needs none: with `SITE_CONFIG_URL` unset it builds against a
committed fixture, so `npm run build` works offline. Point it at a running
API to see real prices:

```bash
SITE_CONFIG_URL=http://localhost:3001/api/public/site-config npm run dev -w @portalai/site
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start all dev servers |
| `npm run build` | Build all packages |
| `npm run test` | Run tests across monorepo |
| `npm run lint` | Lint all packages |
| `npm run format` | Format all packages |
| `npm run type-check` | TypeScript validation |
| `npm run storybook` | Start Storybook servers |

### Operator CLI (`portalops`)

Infrastructure/ops tasks (DB tunnels, psql, reset/seed, cloud config) go through `portalops` — see `packages/devops-cli/README.md` for the full guide and `COMMANDS.md` for the command reference. Quick start:

```bash
npm install && npx turbo run build --filter=@portalai/devops-cli   # one-time (builds cli-env + devops-cli)
aws login                                                          # deployed envs; `local` needs no AWS

npx portalops vars list --env app-dev          # cloud config (secrets masked)
npx portalops db psql --env app-dev            # psql through the SSM tunnel
npx portalops db reset --env local             # local DB reset (DATABASE_URL from packages/devops-cli/.env)
```

`--env` is always required (no default). Prefer a bare `portalops`? `alias portalops="npx portalops"` or `npm link` inside `packages/devops-cli`.

## Documentation

Each package has detailed documentation in its README:

- [`apps/web/README.md`](apps/web/README.md) — Frontend setup, routing, auth, theming, testing
- [`apps/api/README.md`](apps/api/README.md) — API setup, database schema workflow, repositories, style guide
- [`packages/core/README.md`](packages/core/README.md) — Component library, model architecture, theme system

## Deployment Guide

Two deployment shapes:

- **SaaS (managed)** — AWS ECS Fargate + S3/CloudFront, described below.
- **Full residency (self-hosted)** — the whole app (API + web + data deps) as
  one Helm release, for customers who run it in their own cluster. See
  [`deploy/helm/portalai/README.md`](deploy/helm/portalai/README.md). Additive:
  the SaaS path is untouched.

### Architecture

The dev environment runs on AWS with ECS Fargate (API), S3 + CloudFront (frontend), RDS PostgreSQL, and ElastiCache Redis. Infrastructure is defined in CloudFormation templates under `infra/cloudformation/`.

```
Route 53
  app-dev.portalsai.io → CloudFront → S3
  api-dev.portalsai.io → ALB → ECS Fargate (private subnet)
                                  ├── RDS PostgreSQL
                                  └── ElastiCache Redis
```

### CI/CD Pipeline

Merging to `main` triggers `.github/workflows/deploy-dev.yml`. The test suites already passed on the PR, so a merge doesn't re-run them; a manual `workflow_dispatch` does (#427):

1. **Deploy infra** — deploys the CloudFormation stacks below (no-op if unchanged)
2. **Deploy frontend** — builds the web app with its `VITE_*` values, syncs to S3, invalidates CloudFront
3. **Deploy backend** — builds the API image, Trivy-gates it, pushes it with an SBOM and provenance, signs it with cosign (`docs/SUPPLY_CHAIN.md`), runs migrations then the seed as one-off ECS tasks, and updates the ECS service; also gates, attests, signs and pushes the residency web image (both platforms)
4. **Tag** — creates a `dev-YYYYMMDDHHMMSS-<sha>` git tag
5. **Verify login** — signs in to app-dev as its QA owner (#489)

The marketing site deploys separately (`deploy-site-dev.yml`). Production deploys run from a published GitHub release — see [`docs/PROD_DEPLOY.runbook.md`](docs/PROD_DEPLOY.runbook.md).

### CloudFormation Stacks

| Stack | Template | Purpose |
|-------|----------|---------|
| `portalai-dev-network` | `network.yml` | VPC, subnets, NAT gateway |
| `portalai-dev-dns-certs` | `dns-certs.yml` | ACM wildcard certificate |
| `portalai-dns-email` | `dns-email.yml` | Mail DNS records for the domain |
| `portalai-dev-database` | `database.yml` | RDS PostgreSQL |
| `portalai-dev-cache` | `cache.yml` | ElastiCache Redis (encrypted at rest and in transit, #852) |
| `portalai-dev-bastion` | `bastion.yml` | SSM-only bastion for `portalops db tunnel` |
| `portalai-dev-frontend` | `frontend.yml` | S3 bucket, CloudFront, DNS |
| `portalai-dev-site` | `site.yml` | Marketing site bucket, CloudFront, DNS |
| `portalai-dev-backend` | `backend.yml` | ECR, ECS cluster/service, ALB, DNS |
| `portalai-demo-toolpack` | `demo-toolpack.yml` | The demo org's reference custom toolpack (Lambda) |

`iam.yml` (the `portalai-iam` stack: scoped deploy roles, operator roles, the MFA-gated break-glass group, #397) is applied by an administrator, not by CI — see [`docs/AWS_CLI_OPS.md`](docs/AWS_CLI_OPS.md).

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `AWS_ROLE_ARN` | OIDC IAM role for GitHub Actions (the scoped dev deploy role) |
| `DEV_HOSTED_ZONE_ID` | Route 53 hosted zone ID |
| `DEV_SECRET_ARN_*` | Secrets Manager ARNs (full, with suffix) for `DATABASE_URL`, `ENCRYPTION_KEY`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY`, `GEOCODING_API_KEY`, `GOOGLE_OAUTH_CLIENT_SECRET`, `MICROSOFT_OAUTH_CLIENT_SECRET`, `OAUTH_STATE_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `GITHUB_DISPATCH_TOKEN` |
| `DEV_VITE_AUTH0_DOMAIN` / `_CLIENT_ID` / `_AUDIENCE` | Auth0 SPA config baked into the web build |
| `DEV_VITE_AUTH0_QA_CONNECTION` | The QA sign-in's Auth0 Database connection (#489) |
| `TURBO_TOKEN`, `TURBO_REMOTE_CACHE_SIGNATURE_KEY` | Turborepo remote cache (with the `TURBO_TEAM` variable, #454) |

The repository may still hold `DEV_VITE_GOOGLE_*` and `PROD_VITE_GOOGLE_*` secrets. Nothing reads them: the Google Picker's config comes from the API at runtime (#580). Delete them, don't rotate them (#915).

### Verifying a Deploy

```bash
# Check API health
curl https://api-dev.portalsai.io/api/health
# Returns: { "success": true, "payload": { "version": "dev-<sha>", "sha": "<sha>", "timestamp": "..." } }

# Check frontend
# Visit https://app-dev.portalsai.io — version displays in the sidebar

# Check deploy tags
git tag -l "dev-*"
```

### Detailed Docs

- [`docs/PROD_DEPLOY.runbook.md`](docs/PROD_DEPLOY.runbook.md) and [`docs/PROD_PROVISIONING.runbook.md`](docs/PROD_PROVISIONING.runbook.md) — production releases and environment setup
- [`docs/SUPPLY_CHAIN.md`](docs/SUPPLY_CHAIN.md) — image scanning, attestation and signing
- [`docs/DEPLOYMENT_SECURITY_REVIEW.md`](docs/DEPLOYMENT_SECURITY_REVIEW.md) — the per-deployment security review, with the SaaS baseline

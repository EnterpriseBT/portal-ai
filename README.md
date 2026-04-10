# Portals.ai

A Turborepo monorepo for displaying dynamic UI content from a Model-Controller-Presenter architecture.

## Tech Stack

- **Frontend**: React 19, TypeScript, Vite, Material UI, TanStack Router/Query, Auth0
- **Backend**: Node.js, Express, TypeScript, Drizzle ORM, PostgreSQL, Auth0 JWT
- **Shared**: Zod domain models, MUI component library
- **Tooling**: Turborepo, ESLint, Prettier, Jest, Storybook

## Monorepo Structure

```
apps/
  web/          → React frontend (localhost:3000)
  api/          → Express API server (localhost:3001)
packages/
  core/         → Shared UI components, themes, and Zod domain models
```

## Getting Started

### Prerequisites

- Node.js v18+
- npm 10+
- PostgreSQL (for API)

### Setup

```bash
# Install dependencies
npm install

# Build all packages (required on first run)
npm run build

# Start all dev servers
npm run dev
```

### Environment Variables

Copy `.env.example` to `.env` in each app directory:

- `apps/web/.env` — Auth0 client config (`VITE_AUTH0_*`)
- `apps/api/.env` — Auth0 API config, database URL, CORS settings

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

## Documentation

Each package has detailed documentation in its README:

- [`apps/web/README.md`](apps/web/README.md) — Frontend setup, routing, auth, theming, testing
- [`apps/api/README.md`](apps/api/README.md) — API setup, database schema workflow, repositories, style guide
- [`packages/core/README.md`](packages/core/README.md) — Component library, model architecture, theme system

## Deployment Guide

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

Merging to `main` triggers `.github/workflows/deploy-dev.yml`:

1. **Test** — runs unit and integration tests
2. **Deploy infra** — deploys all CloudFormation stacks (no-op if unchanged)
3. **Deploy frontend** — builds web app with `VITE_*` env vars, syncs to S3, invalidates CloudFront
4. **Deploy backend** — builds ARM64 Docker image, pushes to ECR, runs migrations, runs seed, updates ECS service
5. **Tag** — creates a `dev-YYYYMMDDHHMMSS-<sha>` git tag

### CloudFormation Stacks

| Stack | Template | Purpose |
|-------|----------|---------|
| `portalai-dev-network` | `network.yml` | VPC, subnets, NAT gateway |
| `portalai-dev-dns-certs` | `dns-certs.yml` | ACM wildcard certificate |
| `portalai-dev-database` | `database.yml` | RDS PostgreSQL |
| `portalai-dev-cache` | `cache.yml` | ElastiCache Redis |
| `portalai-dev-frontend` | `frontend.yml` | S3 bucket, CloudFront, DNS |
| `portalai-dev-backend` | `backend.yml` | ECR, ECS cluster/service, ALB, DNS |

### GitHub Secrets Required

| Secret | Description |
|--------|-------------|
| `AWS_ROLE_ARN` | OIDC IAM role for GitHub Actions |
| `DEV_HOSTED_ZONE_ID` | Route 53 hosted zone ID |
| `DEV_SECRET_ARN_DATABASE_URL` | Secrets Manager ARN (full, with suffix) |
| `DEV_SECRET_ARN_ENCRYPTION_KEY` | Secrets Manager ARN |
| `DEV_SECRET_ARN_AUTH0_WEBHOOK_SECRET` | Secrets Manager ARN |
| `DEV_SECRET_ARN_ANTHROPIC_API_KEY` | Secrets Manager ARN |
| `DEV_SECRET_ARN_TAVILY_API_KEY` | Secrets Manager ARN |
| `DEV_VITE_AUTH0_DOMAIN` | Auth0 tenant domain |
| `DEV_VITE_AUTH0_CLIENT_ID` | Auth0 SPA client ID |
| `DEV_VITE_AUTH0_AUDIENCE` | Auth0 API audience |

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

- [`docs/DEV_DEPLOYMENT.spec.md`](docs/DEV_DEPLOYMENT.spec.md) — Full architecture specification
- [`docs/DEV_DEPLOYMENT.implementation.md`](docs/DEV_DEPLOYMENT.implementation.md) — Step-by-step implementation plan

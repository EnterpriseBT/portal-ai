# Dev Environment Deployment Architecture — Discovery

## Current State

- **Monorepo**: Turborepo with three packages — `apps/web` (Vite+React), `apps/api` (Express+Node), `packages/core` (shared lib)
- **Local infra**: Docker Compose provides Postgres 17, Redis 7, and an Ollama container
- **CI**: Two GitHub Actions workflows exist (unit tests, integration tests) with a shared setup action
- **IaC**: None — no CloudFormation, CDK, SAM, or Serverless Framework files exist yet
- **Existing Dockerfile**: Dev-only image (tooling container), not a production-ready API image

---

## Domain & DNS Strategy

### Single Domain, Subdomains Per Environment

Use **one domain** (`portalsai.io`) for all environments, differentiated by subdomain. This is preferred over separate domains because:

- **One wildcard ACM cert** (`*.portalsai.io`) covers every environment — no extra certs to manage
- **One hosted zone** — all DNS in one place, one set of NS records, cheaper ($0.50/mo per zone)
- **Cookie/CORS isolation is still clean** — `app-dev.portalsai.io` and `app.portalsai.io` don't share cookies by default (cookies are scoped to the exact subdomain unless you explicitly set `Domain=.portalsai.io`)
- **Auth0 isolation** — separate Auth0 applications per environment, subdomain difference is sufficient

> **Cookie/CORS warning**: Never set cookies with `Domain=.portalsai.io` (dot-prefixed apex) — they leak across all subdomains including dev. Keep cookie domains scoped to the exact subdomain. Same applies to CORS — set `CORS_ORIGIN` to the exact subdomain origin for each environment.

### Domain Registration

Two paths to get the domain into Route 53:

1. **Register directly in Route 53**: AWS Console → Route 53 → Registered Domains → Register Domain. Search for the domain, select TLD, fill in contact info. Route 53 handles the registrar side and **automatically creates a Hosted Zone** with the correct NS records.

2. **Transfer or delegate an existing domain**: If already owned elsewhere, either transfer the domain to Route 53 (unlock at current registrar → get auth code → initiate transfer in Route 53), or keep the external registrar and point its NS records at Route 53's hosted zone nameservers.

### Subdomain Convention

| Service | Dev | Production (future) | Staging (future) |
|---------|-----|---------------------|-------------------|
| Frontend | `app-dev.portalsai.io` | `app.portalsai.io` | `app-staging.portalsai.io` |
| API | `api-dev.portalsai.io` | `api.portalsai.io` | `api-staging.portalsai.io` |
| Apex / Marketing | — | `portalsai.io` | — |

### SSL/TLS Certificates

- Request a wildcard ACM certificate: `*.portalsai.io` (plus the apex `portalsai.io`)
- **Important**: The certificate for CloudFront distributions **must** be provisioned in `us-east-1` regardless of the region used for other resources. If the ALB is in a different region, request a second cert in that region.
- Use DNS validation (Route 53 makes this a single click / single CloudFormation resource)
- The same wildcard cert covers both dev and future prod subdomains

#### Via AWS Console (first time / manual)

1. Open **ACM** in the AWS Console — **select `us-east-1` region**
2. Click **Request a certificate** → **Request a public certificate**
3. Add two domain names:
   - `portalsai.io` (apex)
   - `*.portalsai.io` (wildcard — covers all subdomains)
4. Select **DNS validation**
5. Click **Request**
6. On the certificate detail page, click **Create records in Route 53** — ACM adds the CNAME validation records automatically
7. Wait ~2-5 minutes for status to flip from "Pending validation" to **"Issued"**

> If the ALB lives in a different region (e.g. `us-east-2`), repeat the process in that region. CloudFront requires `us-east-1`; ALB requires the cert in its own region.

#### Via CloudFormation (long-term / IaC)

```yaml
AWSTemplateFormatVersion: "2010-09-09"

Parameters:
  DomainName:
    Type: String
    Default: portalsai.io
  HostedZoneId:
    Type: AWS::Route53::HostedZone::Id

Resources:
  Certificate:
    Type: AWS::CertificateManager::Certificate
    Properties:
      DomainName: !Ref DomainName
      SubjectAlternativeNames:
        - !Sub "*.${DomainName}"
      ValidationMethod: DNS
      DomainValidationOptions:
        - DomainName: !Ref DomainName
          HostedZoneId: !Ref HostedZoneId
        - DomainName: !Sub "*.${DomainName}"
          HostedZoneId: !Ref HostedZoneId

Outputs:
  CertificateArn:
    Value: !Ref Certificate
    Export:
      Name: !Sub "${AWS::StackName}-CertArn"
```

When `HostedZoneId` is provided in `DomainValidationOptions`, CloudFormation **automatically creates the DNS validation records** in Route 53 and waits for the cert to be issued before completing the stack.

```bash
aws cloudformation deploy \
  --stack-name portalsai-certs \
  --template-file dns-certs.yml \
  --region us-east-1 \
  --parameter-overrides \
    DomainName=portalsai.io \
    HostedZoneId=Z0123456789EXAMPLE
```

---

## Architecture Options

### Option A: ECS Fargate (Recommended)

> Fully containerized backend on AWS Fargate with managed RDS and ElastiCache.

```
                        ┌─────────────────────────────────────────────────────┐
                        │                    Route 53                         │
                        │  app-dev.portalsai.io ──► CloudFront                 │
                        │  api-dev.portalsai.io ──► ALB                        │
                        └─────────────────────────────────────────────────────┘

┌─── Frontend ───────────────────────┐     ┌─── Backend ──────────────────────────────────┐
│                                    │     │                                              │
│  S3 Bucket (static site)           │     │  VPC                                         │
│    └── CloudFront Distribution     │     │  ├── Public Subnets                          │
│         └── ACM Cert (us-east-1)   │     │  │   └── ALB (api-dev.portalsai.io)            │
│                                    │     │  │        └── ACM Cert                       │
└────────────────────────────────────┘     │  ├── Private Subnets                         │
                                           │  │   ├── ECS Fargate Service (API)           │
                                           │  │   ├── RDS PostgreSQL 17                   │
                                           │  │   └── ElastiCache Redis 7                 │
                                           │  └── NAT Gateway (outbound internet)         │
                                           │                                              │
                                           └──────────────────────────────────────────────┘
```

**IaC Breakdown** (CloudFormation nested stacks or separate stack files):

| Stack | Resources | Notes |
|-------|-----------|-------|
| `network.yml` | VPC, public/private subnets, NAT GW, IGW, route tables | Shared foundation |
| `dns-certs.yml` | Route 53 records, ACM certificates (wildcard) | Must deploy cert in us-east-1 for CloudFront |
| `database.yml` | RDS PostgreSQL instance, security groups, subnet group | Private subnet only |
| `cache.yml` | ElastiCache Redis cluster, security groups, subnet group | Private subnet only |
| `frontend.yml` | S3 bucket, CloudFront distribution, OAC, Route 53 alias | Static hosting |
| `backend.yml` | ECR repo, ECS cluster, Fargate task def, ECS service, ALB, target group, security groups | Container hosting |

**Pros:**
- Closest to the existing Docker Compose model — containers with similar service topology
- No server management (Fargate is serverless containers)
- RDS and ElastiCache are managed, with automated backups, patching, and failover
- Horizontal scaling via ECS service auto-scaling
- Clean separation of concerns across stacks — each can be updated independently
- Production-ready path: increase instance sizes, enable Multi-AZ, add read replicas

**Cons:**
- **Cost**: NAT Gateway (~$32/mo), RDS (~$15-30/mo for db.t4g.micro), ElastiCache (~$13/mo for cache.t4g.micro), ALB (~$16/mo), Fargate tasks. **Estimated dev total: ~$100-150/month**
- More moving parts to debug vs. a single EC2 instance
- Initial CloudFormation setup is more verbose
- NAT Gateway cost is fixed regardless of traffic

**Risks:**
- Cold starts on Fargate tasks can add latency if tasks scale to zero (mitigate: keep `desiredCount: 1`)
- Database migrations need a strategy — run as a one-off ECS task or as part of the deploy pipeline before the new task definition goes live
- Secrets management: must use AWS Secrets Manager or SSM Parameter Store to inject env vars into Fargate tasks (not hardcoded in task definitions)

---

### Option B: Single EC2 Instance with Docker Compose

> Run the existing Docker Compose setup (minus dev tooling) on a single EC2 instance.

```
                        ┌─────────────────────────────────────────────────────┐
                        │                    Route 53                         │
                        │  app-dev.portalsai.io ──► CloudFront                 │
                        │  api-dev.portalsai.io ──► EC2 (Elastic IP)           │
                        └─────────────────────────────────────────────────────┘

┌─── Frontend ───────────────────────┐     ┌─── Backend ──────────────────────────────────┐
│                                    │     │                                              │
│  S3 Bucket (static site)           │     │  EC2 Instance (t3.small)                     │
│    └── CloudFront Distribution     │     │  ├── Docker Compose                          │
│         └── ACM Cert (us-east-1)   │     │  │   ├── API container (Node)                │
│                                    │     │  │   ├── PostgreSQL 17 container              │
└────────────────────────────────────┘     │  │   └── Redis 7 container                   │
                                           │  └── Caddy/Nginx reverse proxy (TLS)         │
                                           │                                              │
                                           └──────────────────────────────────────────────┘
```

**IaC Breakdown:**

| Stack | Resources | Notes |
|-------|-----------|-------|
| `dns-certs.yml` | Route 53 records, ACM cert | Same as Option A |
| `frontend.yml` | S3 bucket, CloudFront, OAC | Same as Option A |
| `backend.yml` | EC2 instance, security group, Elastic IP, IAM role, EBS volume | UserData script pulls and runs docker-compose |

**Pros:**
- **Cheapest**: ~$20-40/month (t3.small + EBS + CloudFront). No NAT GW, no ALB, no managed DB costs
- Simplest mental model — it's the same Docker Compose from local dev
- Fast to get running; minimal CloudFormation
- Easy SSH debugging

**Cons:**
- **Not production-viable**: single point of failure, no auto-scaling, no managed backups
- Database lives on a Docker volume on EC2 — data loss risk if instance terminates (mitigate: EBS snapshots via lifecycle policy)
- Must manage OS patches, Docker updates, security hardening
- Harder to evolve to production without a complete re-architecture
- Deployment strategy is more fragile (SSH + docker compose pull vs. ECS rolling deploy)

**Risks:**
- EC2 instance failure = full outage with potential data loss
- Docker Compose on EC2 is not a deployment primitive GitHub Actions understands natively — requires SSH-based deploys or SSM Run Command
- Resource contention: API, Postgres, and Redis share CPU/memory on a single instance
- Does not meet the "containerized services" requirement in spirit (containers, but not orchestrated)

---

### Option C: ECS Fargate + Serverless Aurora + ElastiCache Serverless

> Like Option A, but with serverless database and cache tiers that scale to near-zero.

Same architecture diagram as Option A, but replace:
- RDS PostgreSQL → **Aurora Serverless v2** (scales from 0.5 ACU)
- ElastiCache Redis → **ElastiCache Serverless** (scales from baseline)

**Pros:**
- Pay-per-use on database and cache — can be cheaper at very low traffic
- Auto-scales with no capacity planning
- Same production path as Option A, but even smoother scaling

**Cons:**
- **Aurora Serverless v2 minimum**: 0.5 ACU = ~$44/month always-on (more expensive than RDS db.t4g.micro for a dev environment)
- ElastiCache Serverless minimum cost is also higher than a fixed-size node
- **Estimated dev total: ~$150-200/month** — more expensive than Option A for a low-traffic dev environment
- More complex pricing model; harder to predict costs

**Risks:**
- Aurora Serverless v2 cold start when scaling from minimum can add latency
- Relatively new services — less community documentation for troubleshooting

---

## Recommendation

**Option A (ECS Fargate + RDS + ElastiCache)** is the best balance for this project:

1. **Dev-to-prod parity**: The same IaC stacks work for production with parameter changes (instance sizes, Multi-AZ, replica counts)
2. **Managed services**: No patching databases or managing Docker on bare metal
3. **Container-native**: Aligns with the existing Docker Compose workflow and the requirement for containerized services
4. **Composable IaC**: Six small CloudFormation stacks that can be deployed independently
5. **Reasonable cost**: ~$100-150/month for dev is acceptable given the operational simplicity

Option B is viable as a **temporary** cost-saving measure if budget is very tight, but creates tech debt that must be repaid before production. Option C is better suited for production workloads with variable traffic; overkill and more expensive for a dev environment.

---

## Deployment Strategy

### Branch & Release Model

| Event | Environment | Trigger |
|-------|-------------|---------|
| Push/merge to `main` | **Dev** (`*-dev.portalsai.io`) | Automatic — every merge deploys, pipeline tags the deployed SHA |
| GitHub Release (`v*`) | **Production** (`*.portalsai.io`) | Release created — only released versions deploy |

This gives a clean separation: `main` is always the latest development state, and production only advances when you explicitly cut a release. The dev pipeline auto-tags each successful deploy (e.g. `dev-20260409-143022-a1b2c3d`) so there is an audit trail of every build without manual tagging. The same IaC stacks and pipeline logic are reused — only the parameters (subdomains, instance sizes, secrets) differ.

### Workflow Structure

```
.github/
  workflows/
    unit-test.yml           # (existing) runs on all branches
    integration-test.yml    # (existing) runs on all branches
    deploy-dev.yml          # NEW — deploy to dev on push to main
    deploy-prod.yml         # NEW — deploy to prod on tag/release
  actions/
    setup/action.yml        # (existing) Node.js + npm ci
```

### `deploy-dev.yml` — Triggered on push to `main`

```yaml
name: Deploy Dev

on:
  push:
    branches: [main]
  workflow_dispatch:        # manual trigger for ad-hoc deploys

concurrency:
  group: deploy-dev
  cancel-in-progress: false  # don't cancel in-progress deploys

jobs:
  test:
    # Re-run tests as a gate (or use workflow_call to reuse existing test workflows)
    uses: ./.github/workflows/unit-test.yml
    uses: ./.github/workflows/integration-test.yml

  deploy-infra:
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - checkout
      - configure AWS credentials (OIDC or access keys)
      - deploy CloudFormation stacks (network, dns, database, cache — if changed)

  deploy-frontend:
    needs: [deploy-infra]
    runs-on: ubuntu-latest
    env:
      VITE_APP_VERSION: dev-${{ github.sha }}
      VITE_APP_SHA: ${{ github.sha }}
    steps:
      - checkout + setup Node.js
      - npm ci && npm run build (apps/web — VITE_* env vars baked into bundle)
      - aws s3 sync apps/web/dist/ s3://$BUCKET --delete
      - aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"

  deploy-backend:
    needs: [deploy-infra]
    runs-on: ubuntu-latest
    steps:
      - checkout
      - configure AWS credentials
      - login to ECR
      - docker build + push API image to ECR (pass BUILD_VERSION=dev-${{ github.sha }}, BUILD_SHA=${{ github.sha }})
      - run DB migration as one-off ECS task (ecs run-task with migration command)
      - update ECS service with new task definition (rolling deploy)

  tag-deploy:
    needs: [deploy-frontend, deploy-backend]
    runs-on: ubuntu-latest
    steps:
      - checkout
      - name: Tag deployed SHA
        run: |
          TAG="dev-$(date +%Y%m%d%H%M%S)-${GITHUB_SHA::7}"
          git tag "$TAG"
          git push origin "$TAG"
```

### `deploy-prod.yml` — Triggered on GitHub Release

```yaml
name: Deploy Prod

on:
  release:
    types: [published]      # fires when a GitHub Release is created/published

concurrency:
  group: deploy-prod
  cancel-in-progress: false

jobs:
  test:
    uses: ./.github/workflows/unit-test.yml
    uses: ./.github/workflows/integration-test.yml

  deploy-infra:
    needs: [test]
    runs-on: ubuntu-latest
    steps:
      - checkout
      - configure AWS credentials (OIDC — prod role)
      - deploy CloudFormation stacks with prod parameters

  deploy-frontend:
    needs: [deploy-infra]
    runs-on: ubuntu-latest
    env:
      VITE_APP_VERSION: ${{ github.event.release.tag_name }}
      VITE_APP_SHA: ${{ github.sha }}
    steps:
      - checkout + setup Node.js
      - npm ci && npm run build (apps/web — VITE_* env vars baked into bundle)
      - aws s3 sync apps/web/dist/ s3://$PROD_BUCKET --delete
      - aws cloudfront create-invalidation --distribution-id $PROD_DIST_ID --paths "/*"

  deploy-backend:
    needs: [deploy-infra]
    runs-on: ubuntu-latest
    steps:
      - checkout
      - configure AWS credentials (OIDC — prod role)
      - login to ECR
      - docker build + tag with release tag (${{ github.event.release.tag_name }}) + push to ECR (pass BUILD_VERSION=${{ github.event.release.tag_name }}, BUILD_SHA=${{ github.sha }})
      - run DB migration as one-off ECS task
      - update ECS service with new task definition (rolling deploy)
```

### Key Pipeline Decisions

| Decision | Choice | Rationale |
|----------|--------|-----------|
| **Dev trigger** | Push to `main` + `workflow_dispatch` | Every merge auto-deploys; pipeline auto-tags the deployed SHA; manual escape hatch for hotfixes |
| **Prod trigger** | GitHub Release (`v*`) | Explicit, auditable releases; release = deliberate promotion of a verified dev deploy |
| **Test gate** | Re-run tests in both pipelines | Never deploy untested code, even if tests passed on the PR |
| **Frontend deploy** | S3 sync + CloudFront invalidation | Simple, fast, atomic (CloudFront serves stale until invalidation completes) |
| **Backend deploy** | ECR push + ECS service update | Rolling deployment with health checks; automatic rollback on failure |
| **Image tagging** | Dev: `dev-<timestamp>-<sha>`, Prod: `v1.2.3` | Dev images are auto-tagged by the pipeline; prod images are pinned to the release tag |
| **DB migrations** | One-off ECS task before service update | Runs in the same VPC/security group as the API; fails the pipeline if migration fails |
| **Secrets** | GitHub Actions secrets → AWS Secrets Manager | Pipeline credentials in GitHub; app secrets in AWS Secrets Manager, referenced by ECS task definition |
| **AWS auth** | OIDC federation (preferred) | No long-lived access keys; GitHub's OIDC provider assumes an IAM role. Use separate IAM roles for dev and prod. |

### Release Workflow

Dev deploys automatically on every merge to `main` — no manual steps. To promote to production:

```bash
# 1. Verify the dev environment is stable
# 2. Find the commit SHA from the dev deploy tag (e.g. dev-20260409-143022-a1b2c3d)
# 3. Cut a GitHub Release from that SHA
gh release create v1.0.0 --target <sha> --title "v1.0.0" --notes "Release notes"

# Or use GitHub Releases UI:
#   → Draft new release → Choose tag (create on publish) → Target the verified commit → Publish
```

### Environment Parameterization

Both pipelines use the same CloudFormation templates with different parameters:

| Parameter | Dev | Production |
|-----------|-----|------------|
| `Environment` | `dev` | `prod` |
| `FrontendSubdomain` | `app-dev` | `app` |
| `ApiSubdomain` | `api-dev` | `api` |
| `RdsInstanceClass` | `db.t4g.micro` | `db.t4g.small` (or larger) |
| `RdsMultiAZ` | `false` | `true` |
| `CacheNodeType` | `cache.t4g.micro` | `cache.t4g.small` (or larger) |
| `FargateDesiredCount` | `1` | `2+` |
| `FargateCpu` | `256` | `512+` |
| `FargateMemory` | `512` | `1024+` |

---

## Production-Ready API Docker Image

A new multi-stage Dockerfile is needed for the API (the existing one is dev-tooling only):

```dockerfile
# --- Build stage ---
FROM node:22-alpine AS build
WORKDIR /app
COPY package*.json turbo.json ./
COPY apps/api/package*.json apps/api/
COPY packages/core/package*.json packages/core/
RUN npm ci
COPY packages/core/ packages/core/
COPY apps/api/ apps/api/
RUN npx turbo run build --filter=@portalai/api

# --- Runtime stage ---
FROM node:22-alpine AS runtime
WORKDIR /app
ENV NODE_ENV=production
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./
COPY --from=build /app/packages/core/dist ./node_modules/@portalai/core/dist
COPY --from=build /app/packages/core/package.json ./node_modules/@portalai/core/
EXPOSE 3001
CMD ["node", "dist/index.js"]
```

> This is a starting point — the exact COPY paths will need validation against the monorepo's module resolution. The key principle is: build everything, then copy only the compiled output to a slim runtime image.

---

## Environment Variables & Secrets Strategy

### Categories

| Category | Examples | Storage | Injected Via |
|----------|----------|---------|--------------|
| **Public config** | `PORT`, `LOG_LEVEL`, `NODE_ENV`, `BUILD_VERSION`, `BUILD_SHA` | CloudFormation task definition | ECS container environment |
| **Semi-sensitive** | `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `CORS_ORIGIN` | SSM Parameter Store | ECS `valueFrom` (SSM) |
| **Secrets** | `DATABASE_URL`, `ENCRYPTION_KEY`, `AUTH0_WEBHOOK_SECRET`, API keys | AWS Secrets Manager | ECS `secrets` (Secrets Manager ARN) |
| **Frontend** | `VITE_AUTH0_*`, `VITE_APP_VERSION`, `VITE_APP_SHA` | GitHub Actions env / secrets | Build-time env vars (`VITE_` prefix baked into bundle) |

### Auth0 Configuration

- Create a separate Auth0 **application** and **API** for the dev environment
- Set `VITE_AUTH0_DOMAIN` and `VITE_AUTH0_CLIENT_ID` for the dev frontend
- Set `AUTH0_AUDIENCE` and `AUTH0_DOMAIN` for the dev API
- Update Auth0 allowed callback/logout URLs to `https://app-dev.portalsai.io`

---

## Checklist — Steps to Deploy Dev Environment

### One-Time Setup (Manual)

- [x] Register/transfer domain `portalsai.io` to Route 53
- [x] Request ACM wildcard certificate `*.portalsai.io` in `us-east-1` (for CloudFront) and in your primary region (for ALB)
- [x] Validate ACM certificate via Route 53 DNS
- [x] Create ECR repository for the API image
- [x] Configure GitHub OIDC identity provider in AWS IAM
- [x] Create IAM role for GitHub Actions with permissions for S3, CloudFront, ECR, ECS, CloudFormation
- [x] Store secrets in AWS Secrets Manager (DB password, encryption key, Auth0 secrets, API keys)
- [x] Set up a separate Auth0 dev tenant/application
- [x] Add GitHub Actions secrets: `AWS_ROLE_ARN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_DOMAIN`, etc.

### IaC Deployment Order (First Time)

1. `network.yml` — VPC, subnets, NAT GW
2. `dns-certs.yml` — Route 53 records, ACM cert references
3. `database.yml` — RDS PostgreSQL (depends on network)
4. `cache.yml` — ElastiCache Redis (depends on network)
5. `frontend.yml` — S3 + CloudFront (depends on dns-certs)
6. `backend.yml` — ECR + ECS + ALB (depends on network, database, cache)

### Per-Deploy (Automated by Pipeline)

1. Run tests
2. Deploy/update CloudFormation stacks (if templates changed)
3. Build & push API Docker image to ECR
4. Run database migrations (one-off ECS task)
5. Update ECS service to use new task definition
6. Build frontend (`npm run build` with env vars)
7. Sync to S3, invalidate CloudFront

---

## Cost Estimate (Dev Environment — Option A)

| Resource | Estimated Monthly Cost |
|----------|----------------------|
| NAT Gateway (1 AZ) | $32 |
| RDS PostgreSQL (db.t4g.micro, single-AZ) | $13 |
| ElastiCache Redis (cache.t4g.micro, single-node) | $13 |
| ALB | $16 |
| ECS Fargate (0.25 vCPU, 0.5 GB, 1 task 24/7) | $9 |
| S3 + CloudFront | $1-2 |
| Route 53 Hosted Zone | $0.50 |
| ECR storage | $1 |
| Secrets Manager | $1-2 |
| **Total** | **~$85-90/month** |

> Costs can be reduced by scheduling the dev environment to stop overnight (ECS desired count = 0, RDS stop instance) via a scheduled GitHub Action or EventBridge rule. This could bring the cost to ~$50-60/month.

# Dev Environment Deployment — Specification

> **Architecture**: Option A — ECS Fargate + RDS PostgreSQL + ElastiCache Redis
>
> **Source**: [`DEV_DEPLOYMENT.discovery.md`](./DEV_DEPLOYMENT.discovery.md)
>
> **Scope**: This spec covers the **dev environment** only. Production deployment (`deploy-prod.yml`, prod CloudFormation parameters, prod secrets/Auth0 setup) is deferred to a later phase. The architecture and IaC are designed to support both — only the parameters differ — but production-specific work is out of scope for now.

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Infrastructure as Code (CloudFormation)](#2-infrastructure-as-code-cloudformation)
3. [Production Docker Image](#3-production-docker-image)
4. [CI/CD Pipelines (GitHub Actions)](#4-cicd-pipelines-github-actions)
5. [Environment Variables & Secrets](#5-environment-variables--secrets)
6. [One-Time Setup](#6-one-time-setup)
7. [Deployment Order & Runbook](#7-deployment-order--runbook)

---

## 1. Architecture Overview

```
                        ┌─────────────────────────────────────────────────────┐
                        │                    Route 53                         │
                        │  app-dev.portalsai.io ──► CloudFront                │
                        │  api-dev.portalsai.io ──► ALB                       │
                        └─────────────────────────────────────────────────────┘

┌─── Frontend ───────────────────────┐     ┌─── Backend ──────────────────────────────────┐
│                                    │     │                                              │
│  S3 Bucket (static site)           │     │  VPC                                         │
│    └── CloudFront Distribution     │     │  ├── Public Subnets (2 AZs)                  │
│         └── ACM Cert (us-east-1)   │     │  │   └── ALB (api-dev.portalsai.io)          │
│                                    │     │  ├── Private Subnets (2 AZs)                 │
└────────────────────────────────────┘     │  │   ├── ECS Fargate Service (API)           │
                                           │  │   ├── RDS PostgreSQL 17                   │
                                           │  │   └── ElastiCache Redis 7                 │
                                           │  └── NAT Gateway (1 AZ, cost saving)         │
                                           │                                              │
                                           └──────────────────────────────────────────────┘
```

### Branch & Release Model

| Event | Environment | Trigger |
|-------|-------------|---------|
| Push/merge to `main` | **Dev** (`*-dev.portalsai.io`) | Automatic — pipeline tags deployed SHA |
| GitHub Release (`v*`) | **Production** (`*.portalsai.io`) | Release created from verified dev deploy |

---

## 2. Infrastructure as Code (CloudFormation)

Six CloudFormation stacks, deployed independently. All templates live in `infra/cloudformation/`.

```
infra/
  cloudformation/
    network.yml
    dns-certs.yml
    database.yml
    cache.yml
    frontend.yml
    backend.yml
```

All stacks share a common `Environment` parameter (`dev` | `prod`) that controls naming, sizing, and subdomain selection. Stacks reference each other via CloudFormation exports (`!ImportValue`).

---

### 2.1 `network.yml` — VPC & Networking

**Purpose**: Foundation network layer shared by all backend resources.

**Parameters**:

| Parameter | Type | Default | Description |
|-----------|------|---------|-------------|
| `Environment` | String | `dev` | `dev` or `prod` |
| `VpcCidr` | String | `10.0.0.0/16` | VPC CIDR block |

**Resources**:

| Resource | Type | Details |
|----------|------|---------|
| VPC | `AWS::EC2::VPC` | `10.0.0.0/16`, DNS hostnames enabled |
| InternetGateway | `AWS::EC2::InternetGateway` | Attached to VPC |
| PublicSubnet1 | `AWS::EC2::Subnet` | `10.0.1.0/24`, AZ `a`, `MapPublicIpOnLaunch: true` |
| PublicSubnet2 | `AWS::EC2::Subnet` | `10.0.2.0/24`, AZ `b`, `MapPublicIpOnLaunch: true` |
| PrivateSubnet1 | `AWS::EC2::Subnet` | `10.0.10.0/24`, AZ `a` |
| PrivateSubnet2 | `AWS::EC2::Subnet` | `10.0.11.0/24`, AZ `b` |
| NatGateway | `AWS::EC2::NatGateway` | Public subnet 1 only (single NAT for dev — saves $32/mo) |
| NatEIP | `AWS::EC2::EIP` | Elastic IP for NAT gateway |
| PublicRouteTable | `AWS::EC2::RouteTable` | Default route → IGW |
| PrivateRouteTable | `AWS::EC2::RouteTable` | Default route → NAT GW |

**Exports** (used by downstream stacks):

| Export Name | Value |
|-------------|-------|
| `{Env}-VpcId` | VPC ID |
| `{Env}-PublicSubnet1` | Public subnet 1 ID |
| `{Env}-PublicSubnet2` | Public subnet 2 ID |
| `{Env}-PrivateSubnet1` | Private subnet 1 ID |
| `{Env}-PrivateSubnet2` | Private subnet 2 ID |

---

### 2.2 `dns-certs.yml` — Route 53 & ACM Certificates

**Purpose**: DNS records and TLS certificates. Certificate for CloudFront **must** be deployed in `us-east-1`. If the ALB region differs, a second certificate is needed in that region.

**Prerequisites**: Domain `portalsai.io` registered in Route 53 with an existing hosted zone.

**Parameters**:

| Parameter | Type | Description |
|-----------|------|-------------|
| `Environment` | String | `dev` or `prod` |
| `DomainName` | String | `portalsai.io` |
| `HostedZoneId` | `AWS::Route53::HostedZone::Id` | Existing hosted zone |

**Resources**:

| Resource | Type | Details |
|----------|------|---------|
| WildcardCertificate | `AWS::CertificateManager::Certificate` | `*.portalsai.io` + `portalsai.io`, DNS validation via `HostedZoneId` |
| FrontendDnsRecord | `AWS::Route53::RecordSet` | `app-dev.portalsai.io` → CloudFront alias (added after `frontend.yml` deploys) |
| ApiDnsRecord | `AWS::Route53::RecordSet` | `api-dev.portalsai.io` → ALB alias (added after `backend.yml` deploys) |

> **Note**: The DNS records for CloudFront and ALB reference outputs from `frontend.yml` and `backend.yml` respectively. These records can either live in those downstream stacks or be added to `dns-certs.yml` as a second deploy pass. Placing them in the downstream stacks is simpler — each stack owns its own DNS record.

**Exports**:

| Export Name | Value |
|-------------|-------|
| `{Env}-CertificateArn` | Wildcard certificate ARN |

---

### 2.3 `database.yml` — RDS PostgreSQL

**Purpose**: Managed PostgreSQL 17 instance in private subnets.

**Parameters**:

| Parameter | Type | Default (Dev) | Description |
|-----------|------|---------------|-------------|
| `Environment` | String | `dev` | |
| `InstanceClass` | String | `db.t4g.micro` | Instance size |
| `AllocatedStorage` | Number | `20` | GB |
| `MultiAZ` | String | `false` | `true` for prod |
| `MasterUsername` | String | `portalai` | DB admin user |
| `MasterPasswordSecretArn` | String | — | Secrets Manager ARN for the master password |

**Resources**:

| Resource | Type | Details |
|----------|------|---------|
| DBSubnetGroup | `AWS::RDS::DBSubnetGroup` | Private subnets 1 & 2 |
| DBSecurityGroup | `AWS::EC2::SecurityGroup` | Ingress: TCP 5432 from ECS security group only |
| DBInstance | `AWS::RDS::DBInstance` | PostgreSQL 17, `DeletionPolicy: Snapshot`, auto minor upgrades, encrypted at rest, backup retention 7 days |

> **Password management**: Use `ManageMasterUserPassword: true` to let RDS manage the password in Secrets Manager automatically, or reference a pre-created secret via `MasterUserSecret`.

**Exports**:

| Export Name | Value |
|-------------|-------|
| `{Env}-DbEndpoint` | RDS endpoint address |
| `{Env}-DbPort` | `5432` |
| `{Env}-DbSecurityGroupId` | Security group ID (for ECS to reference as ingress target) |

---

### 2.4 `cache.yml` — ElastiCache Redis

**Purpose**: Managed Redis 7 cluster in private subnets.

**Parameters**:

| Parameter | Type | Default (Dev) | Description |
|-----------|------|---------------|-------------|
| `Environment` | String | `dev` | |
| `NodeType` | String | `cache.t4g.micro` | Instance size |
| `NumCacheNodes` | Number | `1` | 1 for dev, 2+ for prod |

**Resources**:

| Resource | Type | Details |
|----------|------|---------|
| CacheSubnetGroup | `AWS::ElastiCache::SubnetGroup` | Private subnets 1 & 2 |
| CacheSecurityGroup | `AWS::EC2::SecurityGroup` | Ingress: TCP 6379 from ECS security group only |
| RedisCluster | `AWS::ElastiCache::CacheCluster` | Redis 7, engine `redis`, single-node for dev |

**Exports**:

| Export Name | Value |
|-------------|-------|
| `{Env}-RedisEndpoint` | Cache cluster endpoint |
| `{Env}-RedisPort` | `6379` |
| `{Env}-CacheSecurityGroupId` | Security group ID |

---

### 2.5 `frontend.yml` — S3 + CloudFront

**Purpose**: Static hosting for the Vite SPA.

**Parameters**:

| Parameter | Type | Default (Dev) | Description |
|-----------|------|---------------|-------------|
| `Environment` | String | `dev` | |
| `Subdomain` | String | `app-dev` | `app` for prod |
| `DomainName` | String | `portalsai.io` | |
| `CertificateArn` | String | — | From `dns-certs.yml` export (must be `us-east-1`) |
| `HostedZoneId` | String | — | Route 53 hosted zone |

**Resources**:

| Resource | Type | Details |
|----------|------|---------|
| S3Bucket | `AWS::S3::Bucket` | Private, `BucketName: {Subdomain}.{DomainName}`, versioning enabled |
| S3BucketPolicy | `AWS::S3::BucketPolicy` | Allow CloudFront OAC read access only |
| OriginAccessControl | `AWS::CloudFront::OriginAccessControl` | S3 origin signing, `signingProtocol: sigv4` |
| CloudFrontDistribution | `AWS::CloudFront::Distribution` | Alias: `{Subdomain}.{DomainName}`, HTTPS redirect, OAC to S3, `DefaultRootObject: index.html`, custom error page for SPA routing (403/404 → `/index.html` with 200) |
| DnsRecord | `AWS::Route53::RecordSet` | `{Subdomain}.{DomainName}` A-record alias → CloudFront |

**SPA routing**: CloudFront must return `/index.html` for any path that doesn't match an S3 object. Configure `CustomErrorResponses`:

```yaml
CustomErrorResponses:
  - ErrorCode: 403
    ResponseCode: 200
    ResponsePagePath: /index.html
  - ErrorCode: 404
    ResponseCode: 200
    ResponsePagePath: /index.html
```

**Exports**:

| Export Name | Value |
|-------------|-------|
| `{Env}-FrontendBucketName` | S3 bucket name (for pipeline `s3 sync`) |
| `{Env}-CloudFrontDistributionId` | Distribution ID (for pipeline cache invalidation) |

---

### 2.6 `backend.yml` — ECR + ECS Fargate + ALB

**Purpose**: Container hosting for the Express API.

**Parameters**:

| Parameter | Type | Default (Dev) | Description |
|-----------|------|---------------|-------------|
| `Environment` | String | `dev` | |
| `Subdomain` | String | `api-dev` | `api` for prod |
| `DomainName` | String | `portalsai.io` | |
| `CertificateArn` | String | — | ACM cert ARN (**must be in the ALB's region**) |
| `HostedZoneId` | String | — | Route 53 hosted zone |
| `Cpu` | Number | `256` | Fargate vCPU (256 = 0.25 vCPU) |
| `Memory` | Number | `512` | Fargate memory MB |
| `DesiredCount` | Number | `1` | Number of tasks |
| `ImageUri` | String | — | ECR image URI (updated per deploy) |

**Resources**:

| Resource | Type | Details |
|----------|------|---------|
| ECRRepository | `AWS::ECR::Repository` | `portalai-api-{Env}`, lifecycle policy: keep last 10 images |
| ECSCluster | `AWS::ECS::Cluster` | `portalai-{Env}` |
| TaskExecutionRole | `AWS::IAM::Role` | Allows ECS to pull ECR images, read Secrets Manager, write CloudWatch logs |
| TaskRole | `AWS::IAM::Role` | Allows the running container to access S3 (uploads), Secrets Manager (runtime) |
| LogGroup | `AWS::Logs::LogGroup` | `/ecs/portalai-api-{Env}`, retention 30 days |
| TaskDefinition | `AWS::ECS::TaskDefinition` | Fargate, linux/arm64 (Graviton — cheaper), references `ImageUri`, container port 3001, env vars + secrets from SSM/Secrets Manager, health check: `curl -f http://localhost:3001/api/health`, log driver: `awslogs` |
| ALBSecurityGroup | `AWS::EC2::SecurityGroup` | Ingress: TCP 443 from `0.0.0.0/0` |
| ECSSecurityGroup | `AWS::EC2::SecurityGroup` | Ingress: TCP 3001 from ALB security group only. Egress: all (NAT GW for outbound internet, DB, Redis) |
| ALB | `AWS::ElasticLoadBalancingV2::LoadBalancer` | Public subnets, internet-facing |
| ALBListener | `AWS::ElasticLoadBalancingV2::Listener` | HTTPS 443, ACM cert, forward to target group |
| ALBHttpRedirect | `AWS::ElasticLoadBalancingV2::Listener` | HTTP 80 → redirect HTTPS 443 |
| TargetGroup | `AWS::ElasticLoadBalancingV2::TargetGroup` | Type: `ip`, port 3001, health check: `GET /api/health`, interval 30s, healthy threshold 2, unhealthy threshold 3 |
| ECSService | `AWS::ECS::Service` | Fargate launch type, private subnets, assign public IP: false, rolling deployment (min 100%, max 200%), attached to target group |
| DnsRecord | `AWS::Route53::RecordSet` | `{Subdomain}.{DomainName}` A-record alias → ALB |

**Health check path**: `GET /api/health` — returns `200` with `{ version, sha, timestamp }`. Already implemented in `apps/api/src/routes/health.router.ts`.

**Exports**:

| Export Name | Value |
|-------------|-------|
| `{Env}-EcrRepositoryUri` | ECR repo URI (for pipeline image push) |
| `{Env}-EcsClusterName` | ECS cluster name |
| `{Env}-EcsServiceName` | ECS service name |
| `{Env}-EcsSecurityGroupId` | ECS task security group (referenced by DB and cache security groups) |

---

## 3. Production Docker Image

A new multi-stage Dockerfile for the API. Located at `apps/api/Dockerfile`.

> The root `Dockerfile` is the dev-tooling container and remains unchanged.

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
RUN apk add --no-cache curl
COPY --from=build /app/node_modules ./node_modules
COPY --from=build /app/apps/api/dist ./dist
COPY --from=build /app/apps/api/package.json ./
COPY --from=build /app/packages/core/dist ./node_modules/@portalai/core/dist
COPY --from=build /app/packages/core/package.json ./node_modules/@portalai/core/
EXPOSE 3001
HEALTHCHECK --interval=30s --timeout=5s --retries=3 \
  CMD curl -f http://localhost:3001/api/health || exit 1
CMD ["node", "dist/index.js"]
```

> `curl` is installed in the runtime stage for the ECS health check and the `HEALTHCHECK` instruction. The exact `COPY` paths for `@portalai/core` will need validation against the monorepo's module resolution at build time.

### Build args for version metadata

```bash
docker build \
  --build-arg BUILD_VERSION=dev-abc1234 \
  --build-arg BUILD_SHA=abc1234def5678 \
  -f apps/api/Dockerfile \
  .
```

Add to the Dockerfile build stage:

```dockerfile
ARG BUILD_VERSION=dev
ARG BUILD_SHA=local
ENV BUILD_VERSION=$BUILD_VERSION
ENV BUILD_SHA=$BUILD_SHA
```

These flow into `apps/api/src/environment.ts` at runtime via `process.env.BUILD_VERSION` and `process.env.BUILD_SHA`, which are returned by `GET /api/health` and can be used to verify which version is deployed.

---

## 4. CI/CD Pipelines (GitHub Actions)

### 4.1 Workflow file structure

```
.github/
  workflows/
    unit-test.yml               # (existing) on push to all branches
    integration-test.yml        # (existing) on push to all branches
    deploy-dev.yml              # NEW
    deploy-prod.yml             # NEW
  actions/
    setup/action.yml            # (existing) Node.js 22 + npm ci
```

---

### 4.2 `deploy-dev.yml`

**Trigger**: Push to `main` + `workflow_dispatch`

**Concurrency**: `group: deploy-dev`, `cancel-in-progress: false`

**Jobs**:

#### `test`
- Reuse existing test workflows via `workflow_call`
- Both `unit-test.yml` and `integration-test.yml` must pass

#### `deploy-infra`
- **Needs**: `test`
- Checkout code
- Configure AWS credentials via OIDC (`aws-actions/configure-aws-credentials@v4`)
- Deploy CloudFormation stacks that have changed: `network.yml`, `database.yml`, `cache.yml`, `frontend.yml`, `backend.yml`
- Use `aws cloudformation deploy --no-fail-on-empty-changeset` to make idempotent

#### `deploy-frontend`
- **Needs**: `deploy-infra`
- Checkout + setup Node.js 22 via `.github/actions/setup`
- Set build-time env vars:
  ```yaml
  env:
    VITE_APP_VERSION: dev-${{ github.sha }}
    VITE_APP_SHA: ${{ github.sha }}
    VITE_AUTH0_DOMAIN: ${{ secrets.DEV_VITE_AUTH0_DOMAIN }}
    VITE_AUTH0_CLIENT_ID: ${{ secrets.DEV_VITE_AUTH0_CLIENT_ID }}
    VITE_AUTH0_AUDIENCE: ${{ secrets.DEV_VITE_AUTH0_AUDIENCE }}
  ```
- `npm run build --workspace=apps/web`
- `aws s3 sync apps/web/dist/ s3://$BUCKET --delete`
- `aws cloudfront create-invalidation --distribution-id $DIST_ID --paths "/*"`

#### `deploy-backend`
- **Needs**: `deploy-infra`
- Checkout code
- Configure AWS credentials via OIDC
- Login to ECR (`aws-actions/amazon-ecr-login@v2`)
- Build and push Docker image:
  ```bash
  docker build \
    --build-arg BUILD_VERSION=dev-${{ github.sha }} \
    --build-arg BUILD_SHA=${{ github.sha }} \
    -t $ECR_URI:dev-${{ github.sha }} \
    -f apps/api/Dockerfile .
  docker push $ECR_URI:dev-${{ github.sha }}
  ```
- Run DB migration as one-off ECS task:
  ```bash
  aws ecs run-task \
    --cluster $CLUSTER \
    --task-definition $MIGRATION_TASK_DEF \
    --launch-type FARGATE \
    --network-configuration "awsvpcConfiguration={subnets=[$PRIVATE_SUBNETS],securityGroups=[$ECS_SG]}" \
    --overrides '{"containerOverrides":[{"name":"api","command":["npm","run","db:migrate"]}]}'
  ```
  Wait for task to complete successfully before proceeding.
- Update ECS service with new image:
  ```bash
  aws ecs update-service \
    --cluster $CLUSTER \
    --service $SERVICE \
    --force-new-deployment
  ```
  The task definition should reference the `:dev-${{ github.sha }}` image tag. Either register a new task definition revision with the updated image URI, or use a mutable tag like `:latest-dev` that the existing task definition references.

#### `tag-deploy`
- **Needs**: `deploy-frontend`, `deploy-backend`
- Checkout code
- Create and push a deploy tag:
  ```bash
  TAG="dev-$(date +%Y%m%d%H%M%S)-${GITHUB_SHA::7}"
  git tag "$TAG"
  git push origin "$TAG"
  ```

---

### 4.3 `deploy-prod.yml`

**Trigger**: `release: types: [published]`

**Concurrency**: `group: deploy-prod`, `cancel-in-progress: false`

**Jobs**: Same structure as `deploy-dev.yml` with these differences:

| Aspect | Dev | Prod |
|--------|-----|------|
| AWS OIDC role | `arn:aws:iam::role/github-actions-dev` | `arn:aws:iam::role/github-actions-prod` |
| `VITE_APP_VERSION` | `dev-${{ github.sha }}` | `${{ github.event.release.tag_name }}` |
| `BUILD_VERSION` | `dev-${{ github.sha }}` | `${{ github.event.release.tag_name }}` |
| ECR image tag | `dev-${{ github.sha }}` | `${{ github.event.release.tag_name }}` (e.g. `v1.2.3`) |
| CloudFormation params | Dev sizes/subdomains | Prod sizes/subdomains |
| `VITE_AUTH0_*` secrets | `DEV_VITE_AUTH0_*` | `PROD_VITE_AUTH0_*` |
| S3 bucket / CF dist | Dev frontend exports | Prod frontend exports |
| No `tag-deploy` job | Auto-tags on success | Not needed — release tag already exists |

---

### 4.4 Making test workflows reusable

The existing `unit-test.yml` and `integration-test.yml` need a `workflow_call` trigger added so deploy pipelines can call them:

```yaml
on:
  push:
    branches: ["**"]
  workflow_call:    # ← add this line
```

No other changes needed — the jobs run identically whether triggered by push or by the deploy workflow.

---

### 4.5 DB migration strategy

Migrations run as a **one-off ECS task** using the same container image, same VPC, same security groups as the API service. The pipeline:

1. Registers a new task definition revision with the freshly pushed image
2. Runs the migration task with command override: `["npm", "run", "db:migrate"]`
3. Waits for the task to reach `STOPPED` state
4. Checks exit code — **if non-zero, the pipeline fails** and the ECS service is not updated
5. Only after migration succeeds does the service update begin

This guarantees the database schema is forward-compatible before new application code starts serving traffic.

---

## 5. Environment Variables & Secrets

### 5.1 Categories

| Category | Variables | Storage | Injected Via |
|----------|-----------|---------|--------------|
| **Public config** | `PORT`, `NODE_ENV`, `LOG_LEVEL`, `LOG_FORMAT`, `BUILD_VERSION`, `BUILD_SHA` | ECS task definition `environment` | Container env |
| **Semi-sensitive** | `AUTH0_DOMAIN`, `AUTH0_AUDIENCE`, `CORS_ORIGIN`, `NAMESPACE`, `SYSTEM_ID` | SSM Parameter Store | ECS task definition `valueFrom` (SSM ARN) |
| **Secrets** | `DATABASE_URL`, `ENCRYPTION_KEY`, `AUTH0_WEBHOOK_SECRET`, `ANTHROPIC_API_KEY`, `TAVILY_API_KEY` | AWS Secrets Manager | ECS task definition `secrets` (Secrets Manager ARN) |
| **S3 config** | `UPLOAD_S3_BUCKET`, `UPLOAD_S3_REGION`, `UPLOAD_S3_PREFIX` | ECS task definition `environment` | Container env |
| **Frontend (build-time)** | `VITE_AUTH0_DOMAIN`, `VITE_AUTH0_CLIENT_ID`, `VITE_AUTH0_AUDIENCE`, `VITE_APP_VERSION`, `VITE_APP_SHA` | GitHub Actions secrets + pipeline env | Baked into Vite bundle at `npm run build` |
| **Pipeline** | `AWS_ROLE_ARN` | GitHub Actions secrets | OIDC assume-role |

### 5.2 SSM Parameter Store naming convention

```
/portalai/{env}/auth0-domain
/portalai/{env}/auth0-audience
/portalai/{env}/cors-origin
/portalai/{env}/namespace
/portalai/{env}/system-id
```

### 5.3 Secrets Manager naming convention

```
portalai/{env}/database-url
portalai/{env}/encryption-key
portalai/{env}/auth0-webhook-secret
portalai/{env}/anthropic-api-key
portalai/{env}/tavily-api-key
```

### 5.4 Redis URL

Constructed from the ElastiCache stack export: `redis://{Env}-RedisEndpoint:6379`. Set as a container environment variable in the task definition (not a secret — the Redis cluster is network-isolated in private subnets with security group restriction).

### 5.5 Database URL

Constructed from the RDS stack export and Secrets Manager password:
```
postgresql://{MasterUsername}:{password}@{DbEndpoint}:5432/portal_ai
```
Stored as a single connection string in Secrets Manager. The pipeline or a setup script assembles this after the RDS instance is created.

### 5.6 ECS task definition env var mapping

Reference for the `ContainerDefinitions` section of the task definition:

```yaml
Environment:
  - Name: PORT
    Value: "3001"
  - Name: NODE_ENV
    Value: production
  - Name: LOG_LEVEL
    Value: info
  - Name: LOG_FORMAT
    Value: json
  - Name: BUILD_VERSION
    Value: !Ref ImageTag          # or injected per-deploy
  - Name: BUILD_SHA
    Value: !Ref CommitSha         # or injected per-deploy
  - Name: REDIS_URL
    Value: !Sub "redis://${RedisEndpoint}:6379"
  - Name: UPLOAD_S3_BUCKET
    Value: !Ref UploadBucket
  - Name: UPLOAD_S3_REGION
    Value: !Ref AWS::Region
  - Name: UPLOAD_S3_PREFIX
    Value: uploads
Secrets:
  - Name: DATABASE_URL
    ValueFrom: arn:aws:secretsmanager:REGION:ACCOUNT:secret:portalai/dev/database-url
  - Name: ENCRYPTION_KEY
    ValueFrom: arn:aws:secretsmanager:REGION:ACCOUNT:secret:portalai/dev/encryption-key
  - Name: AUTH0_WEBHOOK_SECRET
    ValueFrom: arn:aws:secretsmanager:REGION:ACCOUNT:secret:portalai/dev/auth0-webhook-secret
  - Name: ANTHROPIC_API_KEY
    ValueFrom: arn:aws:secretsmanager:REGION:ACCOUNT:secret:portalai/dev/anthropic-api-key
  - Name: TAVILY_API_KEY
    ValueFrom: arn:aws:secretsmanager:REGION:ACCOUNT:secret:portalai/dev/tavily-api-key
  - Name: AUTH0_DOMAIN
    ValueFrom: arn:aws:ssm:REGION:ACCOUNT:parameter/portalai/dev/auth0-domain
  - Name: AUTH0_AUDIENCE
    ValueFrom: arn:aws:ssm:REGION:ACCOUNT:parameter/portalai/dev/auth0-audience
  - Name: CORS_ORIGIN
    ValueFrom: arn:aws:ssm:REGION:ACCOUNT:parameter/portalai/dev/cors-origin
  - Name: NAMESPACE
    ValueFrom: arn:aws:ssm:REGION:ACCOUNT:parameter/portalai/dev/namespace
  - Name: SYSTEM_ID
    ValueFrom: arn:aws:ssm:REGION:ACCOUNT:parameter/portalai/dev/system-id
```

> **`BUILD_VERSION` and `BUILD_SHA`**: These are set per-deploy, not statically in the CloudFormation template. The pipeline registers a new task definition revision with the current values each time it deploys. Alternatively, pass them as Docker build args so they're baked into the image (simpler — no task definition changes per deploy).

---

## 6. One-Time Setup

### 6.1 Prerequisites

- [x] Domain `portalsai.io` registered in Route 53
- [x] ACM wildcard certificate `*.portalsai.io` issued and validated in `us-east-1`
- [x] ACM certificate issued in the ALB's region (if different from `us-east-1`)

### 6.2 AWS — IAM & OIDC

- [x] Create GitHub OIDC identity provider in AWS IAM:
  ```
  Provider URL: https://token.actions.githubusercontent.com
  Audience: sts.amazonaws.com
  ```
- [x] Create IAM role `github-actions-dev` with trust policy scoped to the repo:
  ```json
  {
    "Effect": "Allow",
    "Principal": { "Federated": "arn:aws:iam::oidc-provider/token.actions.githubusercontent.com" },
    "Action": "sts:AssumeRoleWithWebIdentity",
    "Condition": {
      "StringEquals": { "token.actions.githubusercontent.com:aud": "sts.amazonaws.com" },
      "StringLike": { "token.actions.githubusercontent.com:sub": "repo:<org>/<repo>:ref:refs/heads/main" }
    }
  }
  ```
- [x] Attach managed and inline policies to the role:
  - `AmazonECS_FullAccess` (or scoped equivalent)
  - `AmazonEC2ContainerRegistryPowerUser`
  - S3: `PutObject`, `DeleteObject`, `ListBucket` on the frontend bucket
  - CloudFront: `CreateInvalidation`
  - CloudFormation: `CreateStack`, `UpdateStack`, `DescribeStacks`, `DescribeChangeSet`, `ExecuteChangeSet`
  - Secrets Manager: `GetSecretValue` (for ECS task execution)
  - SSM: `GetParameters` (for ECS task execution)
  - CloudWatch Logs: `CreateLogStream`, `PutLogEvents`
  - IAM: `PassRole` (to pass the ECS task execution and task roles)

### 6.3 AWS — Secrets & Parameters

#### Create Secrets Manager secrets

```bash
aws secretsmanager create-secret --name portalai/dev/database-url \
  --secret-string "placeholder-until-rds-created"

aws secretsmanager create-secret --name portalai/dev/encryption-key \
  --secret-string "$(openssl rand -base64 32)"

aws secretsmanager create-secret --name portalai/dev/auth0-webhook-secret \
  --secret-string "<your-webhook-secret>"

aws secretsmanager create-secret --name portalai/dev/anthropic-api-key \
  --secret-string "<your-anthropic-key>"

aws secretsmanager create-secret --name portalai/dev/tavily-api-key \
  --secret-string "<your-tavily-key>"
```

#### Update a secret (e.g. after RDS is created)

```bash
aws secretsmanager update-secret --secret-id portalai/dev/database-url \
  --secret-string "postgresql://portalai:<password>@<rds-endpoint>:5432/portal_ai"
```

#### Create SSM parameters

```bash
aws ssm put-parameter --name /portalai/dev/auth0-domain \
  --value "<your-dev-domain>.us.auth0.com" --type String

aws ssm put-parameter --name /portalai/dev/auth0-audience \
  --value "https://api-dev.portalsai.io" --type String

aws ssm put-parameter --name /portalai/dev/cors-origin \
  --value "https://app-dev.portalsai.io" --type String

aws ssm put-parameter --name /portalai/dev/namespace \
  --value "portalai-dev-namespace" --type String

aws ssm put-parameter --name /portalai/dev/system-id \
  --value "SYSTEM" --type String
```

#### Update a parameter

```bash
aws ssm put-parameter --name /portalai/dev/cors-origin \
  --value "https://app-dev.portalsai.io" --type String --overwrite
```

### 6.4 Auth0

- [x] Create a separate Auth0 application for the dev environment
- [x] Set allowed callback URLs: `https://app-dev.portalsai.io/callback`
- [x] Set allowed logout URLs: `https://app-dev.portalsai.io`
- [x] Set allowed web origins: `https://app-dev.portalsai.io`
- [x] Create or reuse an Auth0 API with the dev audience
- [x] Configure the Auth0 post-login webhook (see below)

#### Auth0 Post-Login Webhook Setup

The API exposes `POST /api/webhooks/auth0/sync` to sync users on login/registration. Auth0 must be configured to call this endpoint with an HMAC-SHA256 signature.

1. **Generate a shared secret** (already done in step 6.3):
   ```bash
   # This is the same value stored in portalai/dev/auth0-webhook-secret
   openssl rand -hex 32
   ```

2. **Create an Auth0 Action**:
   - Auth0 Dashboard → **Actions** → **Library** → **Build Custom**
   - Name: `Sync User to Portal.ai (Dev)`
   - Trigger: **Login / Post Login**

3. **Action code** — calls the dev API with the HMAC signature:
   ```javascript
   const crypto = require("crypto");

   exports.onExecutePostLogin = async (event, api) => {
     const secret = event.secrets.PORTALAI_WEBHOOK_SECRET;
     const url = "https://api-dev.portalsai.io/api/webhooks/auth0/sync";

     const body = JSON.stringify({
       event_type: "post_login",
       user_id: event.user.user_id,
       email: event.user.email,
       name: event.user.name,
       picture: event.user.picture,
       timestamp: new Date().toISOString(),
     });

     const signature = crypto
       .createHmac("sha256", secret)
       .update(Buffer.from(body))
       .digest("hex");

     await fetch(url, {
       method: "POST",
       headers: {
         "Content-Type": "application/json",
         "X-Auth0-Webhook-Signature": signature,
       },
       body,
     });
   };
   ```

4. **Add the secret to the Action**:
   - In the Action editor sidebar → **Secrets** → **Add Secret**
   - Key: `PORTALAI_WEBHOOK_SECRET`
   - Value: the same hex string stored in `portalai/dev/auth0-webhook-secret` in Secrets Manager

5. **Attach the Action to the Login flow**:
   - Auth0 Dashboard → **Actions** → **Triggers** → **Post Login**
   - Drag the `Sync User to Portal.ai (Dev)` action into the flow

> The API verifies the signature via `verifyWebhookSignature` middleware (`apps/api/src/middleware/webhook-auth.middleware.ts`). The HMAC is computed over the raw JSON body using SHA-256 and compared with the `X-Auth0-Webhook-Signature` header value.

### 6.5 GitHub Actions Secrets

- [x] `AWS_ROLE_ARN` — the `github-actions-dev` IAM role ARN
- [x] `DEV_VITE_AUTH0_DOMAIN`
- [x] `DEV_VITE_AUTH0_CLIENT_ID`
- [x] `DEV_VITE_AUTH0_AUDIENCE`

### 6.6 ECR Repository

- [x] Created by `backend.yml` CloudFormation stack — no manual setup needed
- [x] Alternatively, create manually if you want it to exist before the first stack deploy:
  ```bash
  aws ecr create-repository --repository-name portalai-api-dev --region <region>
  ```

---

## 7. Deployment Order & Runbook

### 7.1 First-time deployment

Stacks must be deployed in dependency order. After the first deploy, all stacks can be updated independently.

```
1. network.yml          ← no dependencies
2. dns-certs.yml        ← needs Route 53 hosted zone (pre-existing)
3. database.yml         ← needs network exports (VPC, private subnets)
4. cache.yml            ← needs network exports (VPC, private subnets)
5. backend.yml          ← needs network, database, cache exports + ACM cert
6. frontend.yml         ← needs ACM cert (us-east-1)
```

Steps 3 and 4 can run in parallel. Steps 5 and 6 can run in parallel.

```bash
# Deploy order (from repo root)
REGION=us-east-2
ENV=dev

aws cloudformation deploy --stack-name portalai-$ENV-network \
  --template-file infra/cloudformation/network.yml \
  --parameter-overrides Environment=$ENV \
  --region $REGION

aws cloudformation deploy --stack-name portalai-$ENV-dns-certs \
  --template-file infra/cloudformation/dns-certs.yml \
  --parameter-overrides Environment=$ENV DomainName=portalsai.io HostedZoneId=ZXXXXXXXXXX \
  --region us-east-1

# parallel
aws cloudformation deploy --stack-name portalai-$ENV-database \
  --template-file infra/cloudformation/database.yml \
  --parameter-overrides Environment=$ENV \
  --region $REGION &

aws cloudformation deploy --stack-name portalai-$ENV-cache \
  --template-file infra/cloudformation/cache.yml \
  --parameter-overrides Environment=$ENV \
  --region $REGION &

wait

# After RDS is created, update DATABASE_URL in Secrets Manager

aws cloudformation deploy --stack-name portalai-$ENV-backend \
  --template-file infra/cloudformation/backend.yml \
  --parameter-overrides Environment=$ENV Subdomain=api-dev DomainName=portalsai.io \
  --capabilities CAPABILITY_IAM \
  --region $REGION &

aws cloudformation deploy --stack-name portalai-$ENV-frontend \
  --template-file infra/cloudformation/frontend.yml \
  --parameter-overrides Environment=$ENV Subdomain=app-dev DomainName=portalsai.io \
  --region $REGION &

wait
```

### 7.2 Per-deploy (automated by pipeline)

This is what `deploy-dev.yml` runs on every merge to `main`:

1. Run unit + integration tests
2. Deploy/update CloudFormation stacks (idempotent — no-ops if unchanged)
3. Build frontend with `VITE_*` env vars → `s3 sync` → CloudFront invalidation
4. Build API Docker image → push to ECR
5. Run DB migration as one-off ECS task (fail pipeline if migration fails)
6. Update ECS service → rolling deployment with ALB health checks
7. Tag deployed SHA (`dev-YYYYMMDDHHMMSS-<sha>`)

### 7.3 Promoting to production

```bash
# 1. Verify dev environment is stable at https://api-dev.portalsai.io/api/health
# 2. Note the SHA from the health response or dev deploy tag
# 3. Cut a GitHub Release targeting that SHA
gh release create v1.0.0 --target <sha> --title "v1.0.0" --notes "Release notes"
# 4. deploy-prod.yml triggers automatically
# 5. Verify at https://api.portalsai.io/api/health
```

### 7.4 Rollback

**Frontend**: Re-run the deploy pipeline for the previous commit, or manually sync the previous build to S3 and invalidate CloudFront.

**Backend**: Update the ECS service to use the previous task definition revision:
```bash
aws ecs update-service \
  --cluster portalai-dev \
  --service portalai-api-dev \
  --task-definition portalai-api-dev:<previous-revision>
```
ECS will perform a rolling deployment back to the old image.

**Database**: Migrations are forward-only. If a migration must be reverted, create a new migration that undoes the change and deploy it through the normal pipeline.

# Portals.ai Dev Deployment — Step-by-Step Implementation Plan

## Context

The spec ([`DEV_DEPLOYMENT.spec.md`](./DEV_DEPLOYMENT.spec.md)) defines a full ECS Fargate deployment architecture for the dev environment. The one-time setup (OIDC, IAM, secrets, SSM parameters, Auth0) is already done. This plan covers building the actual deployment artifacts — CloudFormation templates, Dockerfile, and GitHub Actions workflows — broken into discrete steps that can be deployed and tested independently.

Production deployment is out of scope (deferred to a later phase).

---

## ~~Step 1: Network Stack (`infra/cloudformation/network.yml`)~~ ✅

**Create**: `infra/cloudformation/network.yml`

CloudFormation template with:
- VPC (`10.0.0.0/16`, DNS hostnames enabled)
- Internet Gateway + attachment
- 2 public subnets (`10.0.1.0/24` AZ-a, `10.0.2.0/24` AZ-b) with `MapPublicIpOnLaunch: true`
- 2 private subnets (`10.0.10.0/24` AZ-a, `10.0.11.0/24` AZ-b)
- NAT Gateway (single, public subnet 1) + Elastic IP
- Public route table (default route → IGW), associated to both public subnets
- Private route table (default route → NAT GW), associated to both private subnets
- Parameters: `Environment` (default `dev`), `VpcCidr` (default `10.0.0.0/16`)
- Exports: `{Env}-VpcId`, `{Env}-PublicSubnet1`, `{Env}-PublicSubnet2`, `{Env}-PrivateSubnet1`, `{Env}-PrivateSubnet2`

**Test**:
```bash
aws cloudformation deploy --stack-name portalai-dev-network \
  --template-file infra/cloudformation/network.yml \
  --parameter-overrides Environment=dev \
  --region us-east-1
```
Verify: `aws cloudformation describe-stacks --stack-name portalai-dev-network` — check all exports exist.

---

## ~~Step 2: DNS & Certs Stack (`infra/cloudformation/dns-certs.yml`)~~ ✅

**Create**: `infra/cloudformation/dns-certs.yml`

CloudFormation template with:
- ACM wildcard certificate (`*.portalsai.io` + `portalsai.io`), DNS validation via `HostedZoneId`
- Parameters: `Environment`, `DomainName` (default `portalsai.io`), `HostedZoneId`
- Exports: `{Env}-CertificateArn`

> DNS records for CloudFront and ALB will live in their respective stacks (`frontend.yml`, `backend.yml`) so each stack owns its own record.

> A manual ACM cert already exists for dev. This stack creates a CloudFormation-managed cert so the same pattern works for prod. The manual cert can be deleted once this one is in use.

**Test**:
```bash
aws cloudformation deploy --stack-name portalai-dev-dns-certs \
  --template-file infra/cloudformation/dns-certs.yml \
  --parameter-overrides Environment=dev DomainName=portalsai.io HostedZoneId=<ZONE_ID> \
  --region us-east-1
```
Verify: certificate status is "Issued" in ACM console.

---

## ~~Step 3: Database Stack (`infra/cloudformation/database.yml`)~~ ✅

**Depends on**: Step 1 (network exports)

**Create**: `infra/cloudformation/database.yml`

CloudFormation template with:
- DB subnet group (private subnets 1 & 2 via `!ImportValue`)
- Security group: ingress TCP 5432 — initially open to VPC CIDR (ECS SG doesn't exist yet; will be tightened in Step 6)
- RDS PostgreSQL 17 instance: `db.t4g.micro`, single-AZ, encrypted, backup retention 7 days, `DeletionPolicy: Snapshot`, `ManageMasterUserPassword: true`
- Parameters: `Environment`, `InstanceClass`, `AllocatedStorage`, `MultiAZ`, `MasterUsername`
- Exports: `{Env}-DbEndpoint`, `{Env}-DbPort`, `{Env}-DbSecurityGroupId`

**Test**:
```bash
aws cloudformation deploy --stack-name portalai-dev-database \
  --template-file infra/cloudformation/database.yml \
  --parameter-overrides Environment=dev \
  --region us-east-1
```
Verify: RDS instance is "Available". Note the endpoint. Update `portalai/dev/database-url` in Secrets Manager with the real connection string.

---

## ~~Step 4: Cache Stack (`infra/cloudformation/cache.yml`)~~ ✅

**Depends on**: Step 1 (network exports)

**Can run in parallel with Step 3.**

**Create**: `infra/cloudformation/cache.yml`

CloudFormation template with:
- Cache subnet group (private subnets 1 & 2)
- Security group: ingress TCP 6379 — initially open to VPC CIDR (tightened in Step 6)
- ElastiCache Redis 7 cluster: `cache.t4g.micro`, single-node
- Parameters: `Environment`, `NodeType`, `NumCacheNodes`
- Exports: `{Env}-RedisEndpoint`, `{Env}-RedisPort`, `{Env}-CacheSecurityGroupId`

**Test**:
```bash
aws cloudformation deploy --stack-name portalai-dev-cache \
  --template-file infra/cloudformation/cache.yml \
  --parameter-overrides Environment=dev \
  --region us-east-1
```
Verify: Redis cluster is "Available". Note the endpoint.

---

## ~~Step 5: Production API Dockerfile (`apps/api/Dockerfile`)~~ ✅

**No AWS dependencies — can run anytime.**

**Create**: `apps/api/Dockerfile`

Multi-stage Dockerfile per spec section 3:
- Build stage: `node:22-alpine`, copy monorepo manifests, `npm ci`, copy source, `npx turbo run build --filter=@portalai/api`
- Build args: `BUILD_VERSION` (default `dev`), `BUILD_SHA` (default `local`)
- Runtime stage: `node:22-alpine`, `NODE_ENV=production`, install `curl` + `postgresql-client`, copy dist + node_modules + `@portalai/core`, copy `drizzle/` migrations folder and `drizzle.config.ts`, expose 3001, `HEALTHCHECK`, `CMD ["node", "dist/index.js"]`

> **Note**: The runtime stage copies the entire root `node_modules` (including devDependencies like `drizzle-kit`) so migration tooling is available at deploy time. `postgresql-client` is installed for `psql` access if needed.

**`db:migrate` script fix**: The original script used a hardcoded relative path (`../../node_modules/drizzle-kit/bin.cjs`) that breaks outside the monorepo. Updated to call `drizzle-kit` by name — npm scripts add `node_modules/.bin` to `PATH` automatically, which works in both the monorepo and the Docker container:

```json
"db:migrate": "dotenv -e .env -- drizzle-kit migrate",
"db:migrate:ci": "drizzle-kit migrate"
```

`db:migrate:ci` is the production variant — no `dotenv` wrapper since ECS injects env vars directly.

**Test** (local):
```bash
docker build --build-arg BUILD_VERSION=test --build-arg BUILD_SHA=abc123 \
  -t portalai-api:test -f apps/api/Dockerfile .
docker run --rm portalai-api:test node node_modules/drizzle-kit/bin.cjs --version
curl http://localhost:3001/api/health
# Expect: { version: "test", sha: "abc123", timestamp: "..." }
```

---

## ~~Step 6: Backend Stack (`infra/cloudformation/backend.yml`)~~ ✅

**Depends on**: Steps 1, 2, 3, 4, 5

**Create**: `infra/cloudformation/backend.yml`

CloudFormation template with:
- ECR repository (`portalai-api-{Env}`, lifecycle: keep last 10 images)
- S3 upload bucket (`portalai-{Env}-uploads`, versioning enabled)
- ECS cluster (`portalai-{Env}`)
- Task execution IAM role (ECR pull, Secrets Manager read, CloudWatch logs write)
- Task IAM role (S3 uploads)
- KMS key + CloudWatch log group (`/ecs/portalai-api-{Env}`, 30-day retention, KMS encrypted)
- ECS task definition (Fargate, linux/arm64, container port 3001, env vars + secrets per spec 5.6, health check `curl -f http://localhost:3001/api/health`, awslogs driver)
- ALB security group (ingress TCP 443 + 80 from 0.0.0.0/0)
- ECS security group (ingress TCP 3001 from ALB SG only, egress all)
- ALB (internet-facing, public subnets, drop invalid header fields enabled)
- HTTPS listener (443, ACM cert imported from `{Env}-CertificateArn` export, forward to target group)
- HTTP listener (80, redirect to 443)
- Target group (type `ip`, port 3001, health check `GET /api/health`)
- ECS service (Fargate, private subnets, rolling deploy min 100% max 200%)
- Route 53 A-record alias (`{Subdomain}.{DomainName}` → ALB)
- Parameters: `Environment`, `Subdomain`, `DomainName`, `HostedZoneId`, `Cpu`, `Memory`, `DesiredCount`, `ImageTag`, `BuildVersion`, `BuildSha`, `SecretArn*` (×5)
- Exports: `{Env}-EcrRepositoryUri`, `{Env}-EcsClusterName`, `{Env}-EcsServiceName`, `{Env}-EcsSecurityGroupId`

> **Secrets Manager ARN gotcha**: ECS resolves secrets at task startup by calling `GetSecretValue`. Partial ARNs (without the random 6-character suffix AWS appends) return `ResourceNotFoundException`. Bare secret names (e.g. `portalai/dev/database-url`) are treated as SSM parameters, not Secrets Manager secrets. **The full ARN including suffix is required.** These are passed as stack parameters (`SecretArnDatabaseUrl`, etc.) since the suffix is only known after secret creation.
>
> Retrieve full ARNs with:
> ```bash
> aws secretsmanager describe-secret --secret-id portalai/dev/<name> --query ARN --output text
> ```

> **`DesiredCount=0` for first deploy**: Deploy the stack with `DesiredCount=0` so the ECS service doesn't try to start before the database exists and migrations have run. Scale to 1 after the post-deploy steps below.

**Deploy**:
```bash
# Look up full secret ARNs first (one-time)
aws secretsmanager describe-secret --secret-id portalai/dev/database-url --query ARN --output text
# ... repeat for each secret

aws cloudformation deploy \
  --stack-name portalai-dev-backend \
  --template-file infra/cloudformation/backend.yml \
  --parameter-overrides \
      Environment=dev \
      HostedZoneId=Z0000108E4DFXWIOEOR7 \
      ImageTag=latest \
      DesiredCount=0 \
      BuildVersion=dev \
      BuildSha=local \
      SecretArnDatabaseUrl=<full-arn> \
      SecretArnEncryptionKey=<full-arn> \
      SecretArnAuth0WebhookSecret=<full-arn> \
      SecretArnAnthropicApiKey=<full-arn> \
      SecretArnTavilyApiKey=<full-arn> \
  --capabilities CAPABILITY_NAMED_IAM \
  --region us-east-1 \
  --no-fail-on-empty-changeset
```

**Post-deploy: create database and run migrations**

RDS creates no databases by default. `portal_ai` must be created before migrations can run. Do this via a one-off ECS task using the deployed task definition (which already has `DATABASE_URL` injected):

```bash
# 1. Get task definition ARN
TASK_DEF=$(aws ecs describe-task-definition --task-definition portalai-api-dev \
  --region us-east-1 --query 'taskDefinition.taskDefinitionArn' --output text)

NETWORK="awsvpcConfiguration={subnets=[subnet-0d469f22601cf875a,subnet-01417d621b4dc6210],securityGroups=[sg-018abdd21bea21eb3],assignPublicIp=DISABLED}"

# 2. Create the portal_ai database (connects via DATABASE_URL but targets /postgres)
OVERRIDES=$(cat <<'EOF'
{"containerOverrides":[{"name":"api","command":["node","--input-type=module","-e","const{default:sql}=await import('/app/node_modules/postgres/src/index.js');const u=new URL(process.env.DATABASE_URL);u.pathname='/postgres';const db=sql(u.toString(),{max:1});try{await db.unsafe('CREATE DATABASE portal_ai');console.log('created')}catch(e){if(e.code!=='42P04')throw e;console.log('exists')};await db.end()"]}]}
EOF
)
TASK_ARN=$(aws ecs run-task --cluster portalai-dev --task-definition "$TASK_DEF" \
  --launch-type FARGATE --network-configuration "$NETWORK" \
  --overrides "$OVERRIDES" --region us-east-1 --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster portalai-dev --tasks "$TASK_ARN" --region us-east-1
# Verify exit code is 0

# 3. Run migrations
TASK_ARN=$(aws ecs run-task --cluster portalai-dev --task-definition "$TASK_DEF" \
  --launch-type FARGATE --network-configuration "$NETWORK" \
  --overrides '{"containerOverrides":[{"name":"api","command":["npm","run","db:migrate:ci"]}]}' \
  --region us-east-1 --query 'tasks[0].taskArn' --output text)
aws ecs wait tasks-stopped --cluster portalai-dev --tasks "$TASK_ARN" --region us-east-1
# Verify exit code is 0

# 4. Scale the service up
aws cloudformation deploy --stack-name portalai-dev-backend \
  --template-file infra/cloudformation/backend.yml \
  --parameter-overrides DesiredCount=1 \
  --capabilities CAPABILITY_NAMED_IAM --region us-east-1 --no-fail-on-empty-changeset
```

> The create-database step is a one-time operation. Subsequent deploys only need the migration step.

After this stack deploys, **update the DB and cache security groups** to restrict ingress to the ECS security group (instead of VPC CIDR). This can be done as a stack update to Steps 3 & 4 by adding `EcsSecurityGroupId` as a parameter.

**Verify**:
```bash
curl https://api-dev.portalsai.io/api/health
# Expect: {"success":true,"payload":{"version":"...","sha":"...","timestamp":"..."}}
```

---

## Step 7: Frontend Stack (`infra/cloudformation/frontend.yml`)

**Depends on**: Step 2 (ACM cert). Can run in parallel with Step 6.

**Create**: `infra/cloudformation/frontend.yml`

CloudFormation template with:
- S3 bucket (private, versioning enabled, `BucketName: {Subdomain}.{DomainName}`)
- Bucket policy (allow CloudFront OAC read)
- Origin Access Control (S3, sigv4)
- CloudFront distribution (alias `{Subdomain}.{DomainName}`, HTTPS redirect, OAC to S3, `DefaultRootObject: index.html`, custom error responses 403/404 → `/index.html` with 200 for SPA routing)
- Route 53 A-record alias (`app-dev.portalsai.io` → CloudFront)
- Parameters: `Environment`, `Subdomain`, `DomainName`, `CertificateArn`, `HostedZoneId`
- Exports: `{Env}-FrontendBucketName`, `{Env}-CloudFrontDistributionId`

**Test**:
1. Build frontend locally: `VITE_APP_VERSION=test VITE_APP_SHA=abc123 npm run build --workspace=apps/web`
2. Sync to S3: `aws s3 sync apps/web/dist/ s3://app-dev.portalsai.io --delete`
3. Invalidate CloudFront: `aws cloudfront create-invalidation --distribution-id <ID> --paths "/*"`
4. Visit `https://app-dev.portalsai.io` — verify app loads, check sidebar shows version
5. Test SPA routing — navigate to a deep path, refresh — should still load the app

---

## Step 8: Make Test Workflows Reusable

**Modify**: `.github/workflows/unit-test.yml`, `.github/workflows/integration-test.yml`

Add `workflow_call` trigger to both:
```yaml
on:
  push:
    branches: ["**"]
  workflow_call:
```

**Test**: Push to a branch, verify existing push-triggered tests still run normally.

---

## Step 9: Dev Deploy Pipeline (`.github/workflows/deploy-dev.yml`)

**Depends on**: Steps 1–8 (all infra must be deployed, test workflows must be reusable)

**Create**: `.github/workflows/deploy-dev.yml`

GitHub Actions workflow per spec section 4.2:
- Trigger: `push: branches: [main]` + `workflow_dispatch`
- Concurrency: `deploy-dev`, no cancel-in-progress
- Jobs: `test` (calls unit-test + integration-test), `deploy-infra`, `deploy-frontend`, `deploy-backend`, `tag-deploy`
- OIDC auth via `aws-actions/configure-aws-credentials@v4`
- Frontend: build with `VITE_*` env vars, s3 sync, CloudFront invalidation
- Backend: docker build+push to ECR (`BUILD_VERSION=dev-$SHA`, `BUILD_SHA=$SHA`), run migration as one-off ECS task (`npm run db:migrate:ci`), run seed as one-off ECS task (`npm run db:seed:ci`), update ECS service with `--force-new-deployment`
- Tag: create `dev-YYYYMMDDHHMMSS-<sha>` git tag after successful deploy

**Test**:
1. Merge a small change to `main`
2. Watch the workflow run in GitHub Actions
3. Verify tests pass → infra no-ops → frontend deployed → backend image pushed → migration runs → seed runs → ECS service updated → tag created
4. `curl https://api-dev.portalsai.io/api/health` — version matches the deployed SHA
5. Visit `https://app-dev.portalsai.io` — app loads with correct version in sidebar
6. Check git tags: `git tag -l "dev-*"` — new tag exists

---

## Implementation Order Summary

```
Step 1: network.yml           ← start here, no dependencies
Step 2: dns-certs.yml         ← after Step 1 (or parallel if cert is pre-existing)
Step 3: database.yml      ┐
Step 4: cache.yml         ┤   ← parallel, both need Step 1
Step 5: Dockerfile        ┘   ← parallel, no AWS dependency
Step 6: backend.yml           ← needs 1, 2, 3, 4, 5
Step 7: frontend.yml          ← needs 2 (parallel with Step 6)
Step 8: test workflow_call     ← no infra dependency, can do anytime
Step 9: deploy-dev.yml        ← needs everything above
```

## Files Created/Modified

| File | Action |
|------|--------|
| `infra/cloudformation/network.yml` | Create |
| `infra/cloudformation/dns-certs.yml` | Create |
| `infra/cloudformation/database.yml` | Create |
| `infra/cloudformation/cache.yml` | Create |
| `infra/cloudformation/frontend.yml` | Create |
| `infra/cloudformation/backend.yml` | Create |
| `apps/api/Dockerfile` | Create |
| `apps/api/package.json` | Modify (`db:migrate`, `db:migrate:ci` scripts) |
| `.github/workflows/unit-test.yml` | Modify (add `workflow_call`) |
| `.github/workflows/integration-test.yml` | Modify (add `workflow_call`) |
| `.github/workflows/deploy-dev.yml` | Create |

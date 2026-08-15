# Production AWS infrastructure & deploy workflow — Spec

Pins the contract for [#383](https://github.com/EnterpriseBT/portal-ai/issues/383) (child of epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)): the four template changes, `deploy-prod.yml`'s job graph and its first-deploy bootstrap, the exact parameter values each prod stack receives, and the guard tests that pin the dev-only steps prod must not copy. Rationale is in [`PROD_AWS_INFRA.discovery.md`](./PROD_AWS_INFRA.discovery.md).

## Key decisions (flag for review)

1. **The first deploy bootstraps with `DesiredCount=0`.** `backend.yml` creates the ECR repository *and* an ECS service whose image does not exist yet; with the circuit breaker set to roll back, the stack create fails and the job that would push the image never runs. The workflow detects this and passes `0` for that run only.
2. **`backend.yml` takes `CertificateArn` as a parameter**, matching `frontend.yml` and `site.yml`, and prod is passed the **existing** wildcard ARN. No second ACM certificate — the apex and wildcard share one validation CNAME and a second stack collides on it.
3. **Prod's Redis is an `AWS::ElastiCache::ReplicationGroup` behind an `IsProd` condition.** The current `CacheCluster` cannot have a replica at all, and losing the node strands every in-flight job in `active` holding its entity lock until someone cancels it by hand ([#391](https://github.com/EnterpriseBT/portal-ai/issues/391)).
4. **Three dev-only steps are omitted deliberately**, and pinned by tests rather than only by comments: the domain-wide mail DNS stack, the create-if-absent contact seeding, and `tag-deploy`.
5. **Prod's VPC gets its own CIDR** (`10.1.0.0/16`) — harmless today, and impossible to change later without rebuilding the VPC.
6. **`deploy-prod.yml` runs the test suites** even though the release is cut from a merged `main`. "The tag came from a green commit" is an assumption, not a check.

## Scope

### In scope

- `database.yml`: `BackupRetentionPeriod` + `DeletionProtection` parameters.
- `backend.yml`: `CertificateArn` parameter replacing the import.
- `cache.yml`: an `IsProd`-conditional `ReplicationGroup`, with conditional outputs.
- `.github/workflows/deploy-prod.yml`.
- The `prod` GitHub Environment with required reviewers, and a prod-scoped OIDC deploy role.
- Guard tests in `packages/devops-cli` covering the prod workflow's invariants.
- Runbook additions for cutting a release and rolling back.

### Out of scope

- Vendor accounts and secret values (#384) — this ticket consumes ARNs it is handed.
- Stripe (#385), `www` activation (#386), tier pricing (#325), CLI/doc sweep (#387).
- **Reconciling jobs stranded in `active`** and releasing their entity locks — **[#391](https://github.com/EnterpriseBT/portal-ai/issues/391)**, a real bug affecting app-dev today. This ticket reduces how often it can trigger; it does not fix it.
- Moving the certificate to a domain-level stack (discovery Decision 2, option C).
- A least-privilege operator IAM role; multi-region; WAF; per-org RDS; apex redirect.
- **No schema change: there is no migration and no seed change in this ticket.**

## Surface

### `infra/cloudformation/database.yml`

Two parameters, defaults preserving dev's current behavior exactly:

```yaml
  BackupRetentionPeriod:
    Type: Number
    Default: 7
    MinValue: 1
    MaxValue: 35
    Description: Automated backup retention, days. Prod runs >= 14.
  DeletionProtection:
    Type: String
    Default: "false"
    AllowedValues: ["true", "false"]
```

`DBInstance` consumes them in place of the hardcoded `BackupRetentionPeriod: 7`, plus a new `DeletionProtection: !Ref DeletionProtection`. `DeletionPolicy: Snapshot` / `UpdateReplacePolicy: Snapshot` are unchanged.

### `infra/cloudformation/backend.yml`

Replaces the import at `:420-422`:

```yaml
  CertificateArn:
    Type: String
    Description: ACM certificate ARN for the ALB listener (wildcard *.portalsai.io).
```

```yaml
      Certificates:
        - CertificateArn: !Ref CertificateArn
```

`deploy-dev.yml` must pass it in **both** places it deploys the backend stack (`deploy-infra` and the closing `deploy-backend` step), resolved the same way `frontend.yml`'s is today. Dev's rendered value is unchanged.

### `infra/cloudformation/cache.yml`

```yaml
  ReplicationEnabled:
    Type: String
    Default: "false"
    AllowedValues: ["true", "false"]
    Description: >-
      Prod: a ReplicationGroup with automatic failover and daily snapshots.
      The Redis jobs queue is not a cache — losing the node strands
      in-flight jobs in `active` with their entities locked (#383).
  SnapshotRetentionLimit:
    Type: Number
    Default: 0

Conditions:
  IsReplicated: !Equals [!Ref ReplicationEnabled, "true"]
```

Both resources are declared, each behind a condition (`RedisCluster` gets `Condition: IsSingleNode`). The replicated one:

```yaml
  RedisReplicationGroup:
    Type: AWS::ElastiCache::ReplicationGroup
    Condition: IsReplicated
    Properties:
      ReplicationGroupDescription: !Sub "portalai-${Environment} redis"
      Engine: redis
      EngineVersion: "7.1"
      CacheNodeType: !Ref NodeType
      NumCacheClusters: 2
      AutomaticFailoverEnabled: true
      MultiAZEnabled: true
      SnapshotRetentionLimit: !Ref SnapshotRetentionLimit
      CacheSubnetGroupName: !Ref CacheSubnetGroup
      SecurityGroupIds: [!Ref CacheSecurityGroup]
```

**The outputs must become conditional** — the two resource types expose different attributes, which is the detail most likely to be missed:

```yaml
  RedisEndpoint:
    Value: !If
      - IsReplicated
      - !GetAtt RedisReplicationGroup.PrimaryEndPoint.Address
      - !GetAtt RedisCluster.RedisEndpoint.Address
```

…and the same shape for `RedisPort` (`PrimaryEndPoint.Port`). Export names are unchanged, so `backend.yml`'s `REDIS_URL` import needs no change.

**`NumCacheNodes` keeps its default and is used only by the single-node path.** It is not the redundancy knob and never was.

### `.github/workflows/deploy-prod.yml`

```yaml
on:
  release:
    types: [published]
  workflow_dispatch:

concurrency:
  group: deploy-prod
  cancel-in-progress: false
```

Jobs: `unit-test` + `integration-test` (reused workflows, as dev) → `deploy-infra` → `deploy-frontend` ∥ `deploy-backend`. **No `tag-deploy`.**

Every job that touches AWS assumes `PROD_AWS_ROLE_ARN` and runs in the **`prod` GitHub Environment**.

**Stack parameters**, all under `portalai-prod-…`:

| Stack | Parameters beyond `Environment=prod` |
|---|---|
| network | `VpcCidr=10.1.0.0/16` |
| database | `MultiAZ=true`, `BackupRetentionPeriod=14`, `DeletionProtection=true`, prod `InstanceClass` / `AllocatedStorage` |
| bastion | — |
| cache | `ReplicationEnabled=true`, `SnapshotRetentionLimit=7` |
| frontend | `Subdomain=app`, `CertificateArn=$CERT`, `HostedZoneId` |
| backend | `Subdomain=api`, `CertificateArn=$CERT`, `HostedZoneId`, `FrontendOrigin=https://app.portalsai.io`, all twelve `SecretArn*`, `DesiredCount` |
| site | **not deployed here** — `deploy-static-site.yml` owns it (#386) |
| `portalai-dns-email` | **not deployed here** — domain-wide, owned by the dev pipeline |

`$CERT` resolves from the existing dev-owned cert stack:

```bash
CERT=$(aws cloudformation describe-stacks --stack-name portalai-dev-dns-certs \
  --query "Stacks[0].Outputs[?ExportName=='dev-CertificateArn'].OutputValue" --output text)
```

**The bootstrap conditional**, in `deploy-infra` before the backend stack:

```bash
if aws ecr describe-images --repository-name portalai-api-prod --max-items 1 >/dev/null 2>&1; then
  DESIRED=2
else
  echo "::notice::First deploy — creating the service with DesiredCount=0 (no image in ECR yet)"
  DESIRED=0
fi
```

`deploy-backend`'s closing `cloudformation deploy` always passes `DesiredCount=2`, which is what restores the service after the image lands.

**`deploy-frontend`** mirrors dev's, including the SSM contact-resolution step, with `VITE_API_BASE_URL=https://api.portalsai.io` and the `PROD_VITE_AUTH0_*` secrets.

**`deploy-backend`** mirrors dev's **except**: image tags are `prod-<sha>` (no `:latest`), and it **omits the contact-seeding step** (#319 leaves prod fail-closed by design). A pre-migration RDS snapshot runs before `db:migrate:ci`:

```bash
aws rds create-db-snapshot --db-instance-identifier portalai-prod \
  --db-snapshot-identifier "portalai-prod-premigrate-${GITHUB_SHA::7}-$(date -u +%Y%m%d%H%M%S)"
aws rds wait db-snapshot-completed --db-snapshot-identifier "…"
```

**Each omission carries a comment naming what is missing and why** — absence is invisible, and "restoring parity" is the predictable failure.

### GitHub configuration (operator, not code)

- `prod` Environment with **required reviewers**; `deploy-site-prod.yml` already references it and currently gets an unprotected auto-created one.
- `PROD_AWS_ROLE_ARN` — a distinct OIDC role whose trust policy is scoped to the `prod` environment.
- `PROD_HOSTED_ZONE_ID`, `PROD_VITE_AUTH0_{DOMAIN,CLIENT_ID,AUDIENCE}`, and the twelve `PROD_SECRET_ARN_*` from #384.

## Migration / Seed

**None.** No Drizzle table, Zod model or seed change. The only database-adjacent behavior is the pre-migration snapshot, which is an operational step, not a schema one.

## TDD test plan

CloudFormation has no unit-test surface, so the testable contract is **the workflow's invariants** — which is also where discovery's Decision 4 risk lives. Extending the existing guard turns "we wrote a comment" into "CI fails."

### `packages/devops-cli` — `npm run test:unit -w @portalai/devops-cli`

`src/__tests__/deploy-parity.test.ts` (extend — it already enumerates every workflow that deploys `backend.yml`, so `deploy-prod.yml` is picked up automatically):

1. `deploy-prod.yml` exists and passes **every required `SecretArn*` parameter** — already asserted by the existing `it.each` over backend-deploying workflows; adding the file is what brings it under the guard.
2. The prod workflow passes `Environment=prod` to every `cloudformation deploy`, and never `Environment=dev`.
3. It passes `Subdomain=app` to the frontend stack and `Subdomain=api` to the backend stack — dev rides the defaults, so an omission here silently deploys to `app-dev`.
4. It passes `CertificateArn=` to the backend stack (the parameter added above is required and defaultless).
5. **It does not deploy `dns-email.yml`** — the domain-wide stack.
6. **It does not contain the contact-seeding step** — asserted on the `/portalai/prod/…-email` `put-parameter` shape, so prod cannot publish a `qa@` placeholder.
7. **It has no `tag-deploy` job.**
8. Its `concurrency.group` is `deploy-prod` with `cancel-in-progress: false` — a queued release must never abort a running migration.
9. Both `deploy-dev.yml` and `deploy-prod.yml` pass `CertificateArn` to the backend stack (the regression that would otherwise break dev when the import becomes a parameter).

### Not covered by tests

Template validity is checked with `aws cloudformation validate-template` during implementation, and proven by the app-dev deploy for the three dev-affecting templates. The conditional `cache.yml` outputs are only exercised for real when a prod stack is created — noted as the highest-risk unproven path.

**Totals ≈ 9 cases**, all in `deploy-parity.test.ts`.

## Acceptance criteria

- Publishing a GitHub release deploys app + api end to end with no manual step; the run **pauses for required-reviewer approval**.
- A plain push to `main` deploys **only** to dev and never touches prod.
- **The first prod deploy succeeds from zero** — no manual stack surgery, no placeholder image, no rolled-back backend stack.
- `https://api.portalsai.io/api/health` returns 200; `https://app.portalsai.io` loads and calls `https://api.portalsai.io`, with no `app-dev`/`api-dev` string in the bundle.
- The prod web bundle renders `support@portalsai.io` / `sales@portalsai.io`, not the `qa@` fallback.
- Migrations apply on deploy; an RDS snapshot exists from immediately before them; the seed leaves exactly the catalog tiers + connector definitions.
- `aws rds describe-db-instances` reports `DeletionProtection: true`, `BackupRetentionPeriod >= 14`, `MultiAZ: true` for prod.
- The prod cache is a ReplicationGroup with `AutomaticFailoverEnabled` and a non-zero snapshot retention.
- Prod's VPC CIDR is `10.1.0.0/16`.
- **Dev is unaffected**: an app-dev deploy after these template changes is green and its rendered parameter values are unchanged.
- No prod resource was created by hand — every one traces to a template and a workflow run.

## Risks & rollback

| Risk | Detection | Rollback |
|---|---|---|
| **Bootstrap conditional wrong** — service created with `DesiredCount=0` and never restored | `/api/health` never returns; ECS shows 0 running tasks | Re-run `deploy-backend`, or `cloudformation deploy` with `DesiredCount=2` |
| **`backend.yml` cert parameter breaks dev** — the import becomes a required parameter, so a dev deploy that doesn't pass it fails | The next app-dev deploy fails at the backend stack | Test case 9 is the guard; fix forward by passing it |
| **`cache.yml` conditional outputs wrong** — `PrimaryEndPoint` vs `RedisEndpoint` | Prod backend cannot resolve `REDIS_URL`; tasks fail on boot | Only exercised on a real prod create — the highest-risk unproven path in this ticket |
| **Migration succeeds, image rolls back** — the circuit breaker reverts the task set but **not** the schema | ECS reports a rollback with a migrated DB | The pre-migration snapshot. Standing rule: migrations stay backward-compatible with the previous image |
| **Redis node loss before the reconciliation bug is fixed** | Jobs stuck `active`; entities locked | ReplicationGroup failover makes it rare, not impossible. The unlock still requires direct DB intervention until the separate ticket lands |

**Fail-mode posture.** Deploys fail **closed** — the circuit breaker reverts to the last good task set, and required reviewers gate the run. The exception is the schema/image asymmetry above, which is why the snapshot is not optional.

## Files touched

- Edit: `infra/cloudformation/database.yml` — two parameters
- Edit: `infra/cloudformation/backend.yml` — `CertificateArn` parameter replacing the import
- Edit: `infra/cloudformation/cache.yml` — conditional ReplicationGroup + conditional outputs
- Edit: `.github/workflows/deploy-dev.yml` — pass `CertificateArn` in both backend deploys
- New: `.github/workflows/deploy-prod.yml`
- Edit: `packages/devops-cli/src/__tests__/deploy-parity.test.ts` — the nine cases
- New: `docs/PROD_DEPLOY.runbook.md` — cutting a release, the first-deploy bootstrap, rollback and recovery.
  *(Originally planned as an edit to `docs/PROD_PROVISIONING.runbook.md`. Split during implementation: that file belongs to #384's open branch, so editing it here would conflict between two in-flight PRs — and the two documents have genuinely different audiences and cadences. Provisioning happens once per environment; deploying happens every release.)*

## Next step

`docs/PROD_AWS_INFRA.plan.md` slices this into **three** commits: (1) the three template changes plus dev's workflow passing the cert, with case 9 as its guard — dev-affecting and independently verifiable; (2) `deploy-prod.yml` behind cases 1–8; (3) the runbook additions and the GitHub Environment/role wiring. Slice 1 must land and deploy to app-dev before prod is ever run, since it is the only part with a live blast radius on an existing environment.

*(This section originally sketched four slices with the guard tests as a separate third. The plan corrected it: that ordering would have written `deploy-prod.yml` in one commit and its tests in the next, leaving a boundary where the workflow's invariants are unpinned. The nine cases are split across the slices that introduce the behavior they guard.)*

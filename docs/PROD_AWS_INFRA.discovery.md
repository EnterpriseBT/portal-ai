# Production AWS infrastructure & deploy workflow — Discovery

**Issue:** [EnterpriseBT/portal-ai#383](https://github.com/EnterpriseBT/portal-ai/issues/383) · child of epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)

**Why this exists.** Prod's AWS footprint is already written: every template in `infra/cloudformation/` declares `AllowedValues: [dev, prod]` and takes its sizing knobs as parameters. What does not exist is any stack instantiated with `Environment=prod`, or a pipeline that instantiates them. This is the ticket that stands up the compute/storage/network layer and the release-triggered workflow that owns it.

The templates being parameterized is genuinely most of the work — but "parameterized" is not the same as "has ever been run from zero." `deploy-dev.yml` has been deploying an environment that already exists since April 2026, and **the first-deploy path is not the same path**. The headline finding below is one that only a second environment could surface.

## The current shape

### The stacks and how the dev pipeline drives them

| Stack | Template | Prod notes |
|---|---|---|
| `portalai-dev-network` | `network.yml` | `VpcCidr` parameter, default `10.0.0.0/16` |
| `portalai-dev-dns-certs` | `dns-certs.yml` | wildcard `portalsai.io` + `*.portalsai.io`, DNS-validated |
| `portalai-dev-database` | `database.yml` | `InstanceClass` / `AllocatedStorage` / `MultiAZ` parameterized; **`BackupRetentionPeriod: 7` hardcoded, `DeletionProtection` absent** |
| `portalai-dev-bastion` | `bastion.yml` | the only operator path to the DB |
| `portalai-dev-cache` | `cache.yml` | `NodeType` / `NumCacheNodes` parameters (`cache.t4g.micro` / 1) |
| `portalai-dev-frontend` | `frontend.yml` | `Subdomain` default `app-dev`; takes `CertificateArn` **as a parameter** |
| `portalai-dev-site` | `site.yml` | deployed with `Subdomain=site-dev`; also takes `CertificateArn` as a parameter |
| `portalai-dev-backend` | `backend.yml` | `Subdomain` default `api-dev`; **imports `${Environment}-CertificateArn`** |
| `portalai-dns-email` | `dns-email.yml` | **domain-wide, no `Environment`** — deployed from the dev pipeline (#369) |

`deploy-dev.yml` runs three jobs after the test suites: `deploy-infra` (all stacks, in dependency order), then `deploy-frontend` and `deploy-backend` in parallel, then `tag-deploy`.

### What `deploy-backend` actually does

In order (`deploy-dev.yml:242-400`): log in to ECR → **read the ECR URI out of the existing backend stack** → build and push the image → **read the cluster/service/subnets out of the existing stacks** → `run-task` for `db:migrate:ci`, wait, check exit code → the same for `db:seed:ci` → seed contact SSM params create-if-absent → `cloudformation deploy` the backend stack with the new `BuildVersion`/`BuildSha`.

Every one of those reads assumes the backend stack **already exists and already has an image**.

## The design space

### Decision 1 — the first-deploy bootstrap deadlock

This is the finding that matters most, and it is not in the ticket.

`backend.yml` creates the ECR repository *and* the ECS service in one stack. The task definition's image is `…/portalai-api-${Environment}:${ImageTag}` with `ImageTag` defaulting to `latest` (`backend.yml:456`). The service is created with `DesiredCount: 1` and a **deployment circuit breaker with `Rollback: true`** (`backend.yml:265-272`).

On a fresh environment, `deploy-infra` creates that stack against an ECR repository it just created and which is therefore **empty**. The service starts a task, the pull fails with `CannotPullContainerError`, the circuit breaker trips, and CloudFormation rolls the stack back. `deploy-infra` fails — so `deploy-backend`, the job that would have *pushed the image*, never runs. The pipeline cannot bootstrap itself.

Dev does not exhibit this because its backend stack was created on 2026-04-10 and has had an image ever since; the oldest image surviving the 10-image lifecycle policy is from August, so how it was first seeded is no longer visible.

| | A — `DesiredCount=0` on first deploy | B — split ECR into its own stack | C — push a placeholder image first |
|---|---|---|---|
| Change needed | workflow passes `DesiredCount=0`, then `1` after the image lands | a new `ecr.yml`, deployed before `backend.yml` | a bootstrap step building any image before `deploy-infra` |
| First deploy | two stack updates | clean | clean |
| Every later deploy | unaffected (param stays 1) | unaffected | unaffected |
| Reaches dev | no — parameter only | **yes, resource move between stacks** | no |
| Honest about what it is | yes — an explicit bootstrap step | yes | no — a fake image in a real registry |

**Lean: A, with the workflow making it conditional rather than manual.** The prod workflow can detect an empty repository (or a non-existent stack) and pass `DesiredCount=0` for that run, then let the normal `deploy-backend` job push the image and the final `cloudformation deploy` restore the desired count. B is architecturally cleaner and is the right answer if we ever stand up a third environment, but moving an existing ECR repository between stacks on **dev** is a live-resource migration this ticket should not be carrying. C is the classic trick and I'd rather not: a placeholder image in a production registry is a thing someone finds later and cannot explain.

### Decision 2 — who owns the TLS certificate

`dns-certs.yml` requests `portalsai.io` + `*.portalsai.io` with DNS validation. Its own comment records that two `DomainValidationOptions` entries "cause a duplicate-record error in Route 53" — the apex and the wildcard share one validation CNAME. **Two stacks requesting the same names in the same zone are the same collision**, one level up.

There is also an inconsistency to resolve either way: `frontend.yml` and `site.yml` take `CertificateArn` as a **parameter** (the workflow reads it from the dns-certs stack output), while `backend.yml` **imports** `${Environment}-CertificateArn` (`backend.yml:421`). So prod's backend stack cannot deploy at all unless a `prod-CertificateArn` export exists.

| | A — deploy `portalai-prod-dns-certs` | B — thread the existing ARN into prod | C — a domain-level `portalai-dns-certs` |
|---|---|---|---|
| Validation-record collision | **likely** — same names, same zone | none | none, eventually |
| `backend.yml` change | none | takes `CertificateArn` as a parameter | same |
| Coupling | clean per-env | prod depends on a **dev-named** stack | correct: the cert is a domain fact |
| Migration cost | none | none | moving a live cert between stacks |

**Lean: B now, C recorded as the right end state.** Make `backend.yml` take `CertificateArn` as a parameter like its two siblings — that is a consistency fix worth doing regardless — and pass the existing wildcard ARN to every prod stack. The wildcard already covers `app.`, `api.` and `www.`, so a second certificate buys nothing but a collision risk. The ugliness is real and should be written down: a stack named `portalai-dev-dns-certs` will be serving production. C is the honest model (mail already works this way — `portalai-dns-email` is domain-wide with no `Environment`), but it means moving a live certificate between stacks, which belongs in its own ticket rather than inside the prod standup.

### Decision 3 — trigger, environment, and deploy identity

`deploy-site-prod.yml` already exists and establishes the shape: `on: release: published`, a `prod` GitHub Environment, and repository-level `PROD_AWS_ROLE_ARN` / `PROD_HOSTED_ZONE_ID` secrets.

**Decided by precedent, not re-litigated:** `deploy-prod.yml` uses the same `release: published` trigger, so one published release deploys app, api and site together. What still needs deciding is smaller:

- **The `prod` GitHub Environment does not exist.** No environments exist on the repo at all, so `deploy-site-prod.yml`'s claim that "required reviewers on the `prod` environment are the human gate" is currently untrue — referencing a missing environment auto-creates it *without* protection rules. **Lean: create it with required reviewers as part of this ticket**, and scope the prod OIDC role's trust policy to it. Until then the gate is decorative.
- **A separate deploy identity.** Dev uses an unprefixed `secrets.AWS_ROLE_ARN`. **Lean: a distinct `PROD_AWS_ROLE_ARN`**, since prod shares dev's AWS account and the deploy role is therefore the only thing separating the two pipelines' blast radius.
- **Drop `tag-deploy`.** Under a release trigger the release tag is already the marker.

### Decision 4 — what the prod workflow must deliberately *not* copy

Three steps in `deploy-dev.yml` are dev-only, and copying them would be actively wrong:

- **The mail DNS stack** (`:74-88`). `portalai-dns-email` is domain-wide and already deployed. A prod copy would fight the dev pipeline over the same records.
- **The create-if-absent contact seeding** (`:363-390`). #319 deliberately leaves prod fail-closed; seeding `qa@` placeholders into prod would publish a non-customer-facing address on the public site.
- **`tag-deploy`** (per Decision 3).

**Lean: state each omission in a comment in `deploy-prod.yml`**, naming why. Absence is invisible; a future contributor "restoring parity" is the predictable failure.

### Decision 5 — prod sizing and the irreversible choices

| Knob | Dev | Prod lean | Reversible? |
|---|---|---|---|
| `VpcCidr` | `10.0.0.0/16` | **`10.1.0.0/16`** | **No** — changing a VPC CIDR means recreating the VPC |
| RDS `InstanceClass` | `db.t4g.micro` | a burstable-but-larger class, sized after real traffic | yes |
| RDS `MultiAZ` | `false` | **`true`** | yes (with a failover) |
| `BackupRetentionPeriod` | hardcoded `7` | **parameterize; prod ≥ 14** | yes |
| `DeletionProtection` | absent | **parameterize; prod `true`** | yes |
| Cache resource type | `CacheCluster` (single node, no failover, no persistence) | **`ReplicationGroup`** behind an `IsProd` condition | replacement |

**Lean: give prod a distinct VPC CIDR.** Identical CIDRs are harmless today — separate VPCs may overlap — but they permanently foreclose VPC peering or a transit gateway between environments, and re-CIDRing later means rebuilding the VPC. It costs one parameter now.

**Redis needs a deliberate answer, and the answer is worse than "add a replica."** Traced through the code rather than assumed:

- `cache.yml:50` declares an **`AWS::ElastiCache::CacheCluster`**, not a `ReplicationGroup`. For Redis that resource type is a **single node with no replica and no automatic failover** — AWS requires `NumCacheNodes: 1`. The existing `NumCacheNodes` parameter is therefore a trap: raising it for prod does not add redundancy, it fails the deploy.
- No `SnapshotRetentionLimit` is set, so persistence is **off**. A node replacement loses the entire keyspace.
- BullMQ's durable record is the `jobs` table, and `JobEventsService.transition` is the only thing that moves a job to a terminal status. There is **no startup sweep and no reconciliation** anywhere — the maintenance worker runs exactly one job, the ledger retention purge.
- Per the standing async-job rule, a **non-terminal job locks its entity** (`job-lock.service.ts`, 409 `ENTITY_LOCKED_BY_JOB`) and "locks release when the job reaches a terminal status — no manual unlock paths."

Put together: **losing the Redis node strands every in-flight job in `active` indefinitely, and every entity those jobs lock stays locked until a human intervenes.** It is true in dev today; prod is where it becomes customer-visible.

**Corrected after filing [#391](https://github.com/EnterpriseBT/portal-ai/issues/391):** an earlier draft of this section said there was *no supported unlock*. That is wrong. `POST /api/jobs/:id/cancel` transitions a non-terminal job to `cancelled` — which is terminal, so the lock releases — and it tolerates the BullMQ job having vanished. The UI exposes it from the job detail view. So this is **recoverable without database surgery**; what is missing is anything that leads a user there. The lock alert promises the work is "paused until it finishes," progress sits frozen, and there is no staleness signal, no bulk path and no operator command. The `job-lock.service.ts` header comment ("no manual unlock paths") describes *automatic* release semantics and is what the earlier draft misread.

**Lean: prod gets an `AWS::ElastiCache::ReplicationGroup` with automatic failover and daily snapshots, behind an `IsProd` condition so dev's cluster is not replaced** — changing dev's resource type would swap its endpoint for no benefit. And the stranded-job reconciliation is a **separate bug ticket**, not prod-standup work: it needs a design (sweep on boot? a stale-job age threshold? an operator unlock command?) and it is wrong to invent one inside this ticket.

## Tradeoff comparison

| | Bootstrap (D1-A) | Cert threading (D2-B) | Prod Environment (D3) | Omission comments (D4) | Sizing (D5) |
|---|---|---|---|---|---|
| Spread to spec | Yes | Yes | Yes | Yes | Yes |
| Dev-affecting | No | **Yes** — `backend.yml` parameter | No | No | **Yes** — two new `database.yml` params |
| Blocks first prod deploy | **Yes** | **Yes** | No | No | partly (CIDR) |

## Recommendation

1. **The prod workflow bootstraps the backend stack with `DesiredCount=0`** on a first run, then lets `deploy-backend` push the image and the closing `cloudformation deploy` restore the count. Without this the first deploy deadlocks.
2. **`backend.yml` takes `CertificateArn` as a parameter**, matching `frontend.yml` and `site.yml`, and every prod stack is passed the existing wildcard ARN. No second certificate.
3. **Create the `prod` GitHub Environment with required reviewers**, and scope `PROD_AWS_ROLE_ARN`'s trust policy to it.
4. **`deploy-prod.yml` mirrors `deploy-dev.yml`** with `Environment=prod`, `portalai-prod-…` names, explicit `Subdomain=app` / `Subdomain=api`, `PROD_*` secrets, the SSM contact-resolution step for the web build, and **commented omissions** for mail DNS, contact seeding and `tag-deploy`.
5. **Parameterize `BackupRetentionPeriod` and `DeletionProtection`** in `database.yml`; prod gets ≥ 14 days and protection on.
6. **Prod gets `VpcCidr=10.1.0.0/16`**, RDS `MultiAZ=true`, and an ElastiCache **`ReplicationGroup`** with automatic failover and daily snapshots — a replica is not reachable by parameter, because the current resource type cannot have one.
7. **Take an RDS snapshot before the migrate step** — the dev workflow has none, and a failed prod migration must be recoverable.

## Open questions

1. ~~What happens to a job that was `active` when Redis is lost?~~ **Answered from the code — see Decision 5.** They are stranded in `active` indefinitely and hold their entity locks; cancelling the job releases them, but nothing tells the user that. The mitigation here is a `ReplicationGroup` with failover and snapshots; the reconciliation gap is **[#391](https://github.com/EnterpriseBT/portal-ai/issues/391)**, and it applies to app-dev today.
2. **Does the first prod deploy run migrations against an empty database, or does #384's bootstrap run first?** #384's runbook creates `portal_ai` by hand after the database stack. **Lean: the database stack deploys in this ticket's `deploy-infra`, then #384's step 10 runs, then the backend stack** — the two children interleave, as the epic already records.
3. **Should `deploy-prod.yml` run the test suites?** Dev gates on `unit-test` + `integration-test`. A release is cut from an already-merged `main` whose tests passed. **Lean: run them anyway.** They are cheap relative to a bad production deploy, and "the tag was cut from a green commit" is an assumption, not a check.
4. **Is `DesiredCount=1` right for prod at all?** One task means every deploy is a brief gap and any task failure is an outage. **Lean: 2**, which the ALB and `MinimumHealthyPercent: 100` already support without template changes.

## Enterprise-scale considerations

- **Concurrency & correctness.** `concurrency.group: deploy-prod` serializes deploys. The migrate task is the risk: two overlapping releases could run migrations concurrently. **Lean: the concurrency group is sufficient**, with `cancel-in-progress: false` so a queued release waits rather than aborting a half-finished migration.
- **Accuracy & auditability.** The release-notes field is the deployment journal, and the workflow run is the record of what was deployed. **Lean: sufficient** — this is why the release trigger beat `workflow_dispatch`.
- **Failure modes.** The deployment circuit breaker with rollback is the right posture for prod (fail closed, revert to the last good task set). The gap is **database migrations, which do not roll back with it** — a migrated schema plus a rolled-back image is the dangerous state. **Lean: pre-migration snapshot, and keep migrations backward-compatible with the previous image** as a standing rule worth writing into the runbook.
- **Scale & unbounded growth.** Not a first-deploy concern; the ECR lifecycle policy already caps image retention at 10.
- **Multi-tenancy.** No per-tenant dimension in the infrastructure — one shared RDS, one cluster. Out of scope for the epic and unchanged here.
- **Contract stability.** Every template already takes `Environment` and `AllowedValues: [dev, prod]`; this ticket adds parameters (cert ARN, retention, deletion protection) rather than new concepts, so a third environment is a workflow copy plus values. **Lean: additive only.**
- **Data lifecycle.** `DeletionProtection` plus retention ≥ 14 days is the floor. The `DeletionPolicy: Snapshot` / `UpdateReplacePolicy: Snapshot` already on the DB instance covers stack-level deletion. **Lean: sufficient**, but the retention number is a business decision that should be stated rather than defaulted.

## What this doesn't decide

- **Vendor accounts, secrets and SSM values** (#384) — this ticket consumes the ARNs it is handed; its backend stack cannot deploy until they exist.
- **Stripe live mode** (#385), **`www` activation** (#386), **tier pricing** (#325), **the CLI/doc sweep** (#387).
- **A least-privilege operator IAM role.** #384 found the operator identity is a full-admin IAM user. Real work, own ticket.
- **Moving the certificate to a domain-level stack** (Decision 2, option C) — the right end state, a live-resource migration, and not this ticket.
- **Reconciling jobs stranded in `active`** after a Redis loss, and releasing the entity locks they hold — a real bug affecting app-dev today (Decision 5). **File it as its own ticket**; this ticket only reduces how often it can be triggered.
- **Multi-region, WAF, per-org RDS, apex redirect** — out of scope for the whole epic.

## Next step

`/spec 383` pins the contract: the two `database.yml` parameters, `backend.yml`'s `CertificateArn` parameter, the `deploy-prod.yml` job graph with its bootstrap conditional, and the exact parameter values each prod stack receives. `/plan 383` then slices it — roughly: (1) the dev-affecting template changes with their parameter defaults preserved, (2) `deploy-prod.yml` itself, (3) the GitHub Environment and role wiring, (4) the runbook additions. The stacks are deployed by the workflow, not by hand — so the acceptance evidence is a green release run, not a local command.

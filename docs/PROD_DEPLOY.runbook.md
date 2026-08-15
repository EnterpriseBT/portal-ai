# Production deploys — Runbook

**Issue:** [EnterpriseBT/portal-ai#383](https://github.com/EnterpriseBT/portal-ai/issues/383) (epic [#83](https://github.com/EnterpriseBT/portal-ai/issues/83)) · Spec: `docs/PROD_AWS_INFRA.spec.md`

How production gets deployed, what the *first* deploy does differently, and how to get back.

**This is not the provisioning runbook.** `docs/PROD_PROVISIONING.runbook.md` (#384) covers standing an environment up once — vendor accounts, the 24 config values, the database bootstrap. This one covers what happens on every release afterwards. Do that one first; nothing here works without it.

---

## What a deploy is

**Publishing a GitHub release** — nothing else. A push to `main` deploys to app-dev and can never reach production.

One published release fires two workflows off the same event:

| Workflow | Deploys | Notes |
|---|---|---|
| `deploy-prod.yml` | `app.portalsai.io` + `api.portalsai.io` | the stacks, the web bundle, the API image |
| `deploy-site-prod.yml` | `www.portalsai.io` | gated on the `PROD_SITE_CONFIG_URL` variable (#386) |

Both run in the **`prod` GitHub Environment**, so both pause for approval.

## One-time setup (before the first release)

- [ ] **Create the `prod` GitHub Environment with required reviewers.**
      Settings → Environments → New environment → `prod` → Required reviewers.
      **This is load-bearing and does not exist by default.** `deploy-site-prod.yml` has referenced the `prod` environment since #311, and referencing an environment that does not exist **auto-creates it with no protection rules** — so the "human gate on a public deploy" its header describes is not real until someone creates it deliberately.
- [ ] **Create the prod deploy role** and store its ARN as the `PROD_AWS_ROLE_ARN` repository secret. It is a **separate role** from the unprefixed `AWS_ROLE_ARN` dev pushes with: prod shares dev's AWS account, so the deploy identity is the main thing keeping the two pipelines' blast radius apart. Scope its OIDC trust policy to this repository **and the `prod` environment**:

      "token.actions.githubusercontent.com:sub": "repo:EnterpriseBT/portal-ai:environment:prod"

- [ ] **`PROD_AWS_ROLE_ARN` and `PROD_HOSTED_ZONE_ID` must be repository secrets, not environment secrets** — `deploy-site-prod.yml` reads them in its caller job, outside the environment.
- [ ] The twelve `PROD_SECRET_ARN_*` and three `PROD_VITE_AUTH0_*` secrets — see the provisioning runbook.

## Cutting a release

1. Confirm `main` is green and carries everything you intend to ship.
2. GitHub → Releases → **Draft a new release**. Create a tag (`v<major>.<minor>.<patch>`) against `main`.
3. Write the release notes. **These are the deployment journal** — the reason the trigger is a release rather than a manual dispatch. Say what changed, not just which PRs merged.
4. **Publish**. Both workflows start.
5. Approve the run when GitHub asks. This is the last point at which stopping is free.
6. Watch `deploy-infra` → then `deploy-frontend` and `deploy-backend` in parallel.

## The first deploy is different

Two things happen once, and only once. Both are expected; neither means something is wrong.

**The ECS service starts at zero.** `backend.yml` creates the ECR repository *and* the ECS service, so on a brand-new environment the service would be created against an empty registry — the task cannot pull an image, the deployment circuit breaker trips, and CloudFormation rolls the whole stack back. Since `deploy-backend` is the job that *pushes* the image, the pipeline could never bootstrap itself.

So `deploy-infra` checks ECR and, finding it empty, creates the service with `DesiredCount=0`. Look for this in the log:

```
Notice: First deploy — creating the ECS service with DesiredCount=0 (ECR is empty); deploy-backend will scale it up.
```

`deploy-backend`'s closing `cloudformation deploy` sets it to 2. **If the run fails between those two points, the service is left at zero** — see Recovery below.

**The database must already have been bootstrapped.** RDS creates only the `postgres` maintenance database; nothing in the repo creates `portal_ai`. The provisioning runbook's step 10 does it, and it has to happen **after** `deploy-infra` creates the database stack and **before** `deploy-backend` migrates. In practice the first release is run twice: once to create the stacks (it will fail at the migrate step), then the bootstrap, then again.

## Rollback

**Re-run the workflow of the previous release.** GitHub → Actions → `Deploy Prod` → the previous successful run → *Re-run all jobs*. It rebuilds that release's ref and rolls the service back to it.

**This reverts the image, not the schema.** The deployment circuit breaker restores the last good task set; a migration that already applied stays applied. Two consequences:

- **Migrations must remain backward-compatible with the previous image.** Additive columns, no destructive renames in the same release as the code that stops using them. This is a standing rule, not advice for the rollback moment — by then it is too late.
- Every deploy takes an RDS snapshot named `portalai-prod-premigrate-<sha>-<timestamp>` immediately before migrating. Restoring it is the escape hatch when a migration cannot be tolerated, and it is a **restore-to-new-instance** operation, not an in-place undo — treat it as an incident, not a rollback step.

## Recovery

| Symptom | Cause | Fix |
|---|---|---|
| `/api/health` never responds; ECS shows 0 running tasks | first-deploy bootstrap didn't complete | Re-run `deploy-backend`, or `aws cloudformation deploy --stack-name portalai-prod-backend … DesiredCount=2` |
| Tasks start then die immediately | a secret ARN does not resolve | `aws ecs describe-tasks` → stopped reason. Cross-check `portalops vars list --env prod` and the `PROD_SECRET_ARN_*` secrets |
| Migrate task exits non-zero on a first deploy | `portal_ai` does not exist yet | Provisioning runbook step 10, then re-run |
| Migrate task exits non-zero otherwise | a real migration failure | Do **not** re-run blindly. Read the task logs; the pre-migration snapshot is the way back |
| `s3 sync` succeeds but the site is stale | CloudFront cache | The invalidation step runs automatically; check it, then wait for propagation |
| A release deploys nothing | it was not *published* (still a draft) | Publish it |

## What `deploy-prod.yml` deliberately does not do

Each omission is asserted by a test in `packages/devops-cli/src/__tests__/deploy-parity.test.ts`, because absence is invisible in review and "restoring parity" with `deploy-dev.yml` is the predictable mistake.

- **The mail DNS stack.** `portalai-dns-email` is domain-wide — one zone, one set of MX records — and is deployed from the dev pipeline. A prod copy would fight it over the same records.
- **Contact-address seeding.** `deploy-dev.yml` seeds `qa@` placeholders create-if-absent. #319 leaves prod fail-closed on purpose so a placeholder can never be published on the public site.
- **A `tag-deploy` job.** Dev stamps a `dev-<timestamp>-<sha>` tag; under a release trigger the release tag already is the marker.
- **The site stack.** `www.portalsai.io` belongs to `deploy-site-prod.yml`, off the same release event.
- **A `:latest` image tag.** Prod pushes only `prod-<sha>`. A mutable tag makes "what is running right now" unanswerable after the fact.

## Notes on the certificate

Prod reads the wildcard `*.portalsai.io` certificate from the **`portalai-dev-dns-certs`** stack, which reads oddly and is deliberate: the apex and the wildcard share one DNS validation CNAME, so a second cert stack for the same names in the same hosted zone collides. Moving the certificate to a domain-level stack — as `portalai-dns-email` already is — is the correct end state and is tracked separately; see `docs/PROD_AWS_INFRA.discovery.md`, Decision 2.

**Do not delete or recreate `portalai-dev-dns-certs`.** It is load-bearing for production.

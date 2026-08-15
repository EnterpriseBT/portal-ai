# Production AWS infrastructure & deploy workflow — Plan

**Implements the spec TDD-first: the three template changes dev shares, then `deploy-prod.yml` behind its guard tests, then the operator wiring.**

Spec: `docs/PROD_AWS_INFRA.spec.md`. Discovery: `docs/PROD_AWS_INFRA.discovery.md`. Issue: #383 (epic #83). Builds on #384, which added the `prod` registry entry and whose twelve `PROD_SECRET_ARN_*` values the backend stack consumes.

3 slices, each behind a green test suite and each leaving the repo compilable. They land as **commits on `feat/prod-aws-infra`**, which PRs into `epic/prod-environment` — never into `main`.

```bash
npm run test:unit -w @portalai/devops-cli
aws cloudformation validate-template --template-body "$(cat infra/cloudformation/<file>.yml)"
```

Each slice: (1) write failing tests; (2) smallest change to green them; (3) focused run; (4) `npm run lint && npm run type-check` at the boundary; (5) next slice.

**Sequencing rationale.** Slice 1 is the only work with a **live blast radius on app-dev** — it changes three templates dev deploys and adds a required parameter to a stack dev already runs. It goes first so it can land, deploy to dev, and be observed green long before prod is attempted. Slice 2 is prod-only and cannot affect dev at all. Slice 3 is operator configuration plus docs, which can only be accurate once the workflow it describes exists.

**Deviation from the spec's sketch, deliberate.** The spec's "Next step" listed the guard tests as their own third slice. That would mean writing `deploy-prod.yml` in one commit and its tests in the next — tests after implementation, which is not TDD and would leave a commit boundary where the workflow's invariants are unpinned. The nine cases are therefore split across the slices that introduce the behavior they guard: case 9 lands with slice 1, cases 1–8 lead slice 2.

---

## Slice 1 — the three template changes dev shares

Everything with a live blast radius, in one reviewable commit: two `database.yml` parameters, `backend.yml`'s certificate parameter, `cache.yml`'s conditional ReplicationGroup, and `deploy-dev.yml` passing the certificate it already resolves.

**Files**

- Edit: `infra/cloudformation/database.yml` — `BackupRetentionPeriod` (default `7`) and `DeletionProtection` (default `"false"`) parameters, consumed by `DBInstance`.
- Edit: `infra/cloudformation/backend.yml` — `CertificateArn` parameter replacing `Fn::ImportValue` at `:420-422`.
- Edit: `infra/cloudformation/cache.yml` — `ReplicationEnabled` + `SnapshotRetentionLimit` parameters, `IsReplicated` condition, `RedisReplicationGroup`, a `Condition: IsSingleNode` on the existing `RedisCluster`, and **conditional `RedisEndpoint` / `RedisPort` outputs**.
- Edit: `.github/workflows/deploy-dev.yml` — pass `CertificateArn` in **both** backend deploys (`deploy-infra`'s create and `deploy-backend`'s closing update).
- Edit: `packages/devops-cli/src/__tests__/deploy-parity.test.ts` — spec case 9.

**Steps**

1. **Tests (spec case 9).** Every workflow that deploys `backend.yml` passes `CertificateArn=`. With `deploy-prod.yml` absent this covers `deploy-dev.yml` alone, which is exactly the regression that matters in this slice: making the import a required parameter breaks the next app-dev deploy if the workflow doesn't pass it. Run; **fail** — dev does not pass it today.
2. **Implement** the four file edits. Green.
3. `aws cloudformation validate-template` on all three templates.
4. Lint + type-check.

**Done when:** all three templates validate, the parity guard covers the certificate parameter, and every default preserves dev's current rendered values (`BackupRetentionPeriod=7`, no deletion protection, single-node cache).

**Risk — the highest in the ticket.** Three live templates change at once.

- `backend.yml`'s parameter is **required and defaultless**, so a workflow that fails to pass it breaks the app-dev deploy. Case 9 is the guard; deliberately no default, because a default would let a genuinely missing value deploy the wrong certificate silently.
- `cache.yml`'s conditional outputs are the part **nothing verifies until a prod stack is created** — `CacheCluster` exposes `RedisEndpoint.Address` while `ReplicationGroup` exposes `PrimaryEndPoint.Address`. Read the `!If` twice; a mistake surfaces as a prod backend that cannot resolve `REDIS_URL`.
- With `ReplicationEnabled` defaulting to `"false"`, dev keeps its existing `RedisCluster` resource and is **not** replaced. Confirm the dev changeset shows no cache resource replacement before merging.

---

## Slice 2 — `deploy-prod.yml`

The pipeline itself, prod-only, unable to affect dev.

**Files**

- Edit: `packages/devops-cli/src/__tests__/deploy-parity.test.ts` — spec cases 1–8.
- New: `.github/workflows/deploy-prod.yml`.

**Steps**

1. **Tests (spec cases 1–8), written first.** They fail on a missing file, which is the point — each one then pins a property of the workflow as it is written:
   - passes `Environment=prod` everywhere and never `Environment=dev`;
   - passes `Subdomain=app` to frontend and `Subdomain=api` to backend (dev rides the defaults, so an omission silently deploys to `app-dev`);
   - passes `CertificateArn=` to the backend stack;
   - **does not** deploy `dns-email.yml`;
   - **does not** contain the contact-seeding `put-parameter` step;
   - has **no** `tag-deploy` job;
   - `concurrency.group: deploy-prod` with `cancel-in-progress: false`;
   - and, by virtue of the file existing, the pre-existing `it.each` assertion that every backend-deploying workflow passes all twelve required `SecretArn*` parameters.
   Run; fail.
2. **Implement** `deploy-prod.yml` per the spec's Surface: release trigger, the `prod` environment, `PROD_*` secrets, the stack parameter table, the `DesiredCount` bootstrap conditional, the SSM contact-resolution step in `deploy-frontend`, the pre-migration RDS snapshot in `deploy-backend`, and a comment at each deliberate omission. Green.
3. Lint + type-check.

**Done when:** the nine cases pass, and every dev-only step the workflow omits is pinned by a test rather than only by a comment.

**Risk:** the bootstrap conditional cannot be exercised until a real first deploy. Its failure mode is benign and recoverable — a service sitting at `DesiredCount=0` — and the fix is re-running `deploy-backend`. Write the `::notice::` so the first-deploy branch is obvious in the run log; that log is the only evidence it took the right path.

---

## Slice 3 — runbook, rollback, and the operator wiring

**Files**

- New: `docs/PROD_DEPLOY.runbook.md` — cutting a release, what the first deploy does differently, and how to roll back.
  *(Split from #384's provisioning runbook during implementation — that file is on an unmerged branch, and the two have different audiences: once per environment vs. every release.)*

**Steps**

1. **No unit tests** — prose plus GitHub configuration. Verification is `/smoke`.
2. **Write** the release-cut procedure, and record the operator steps that are not code: creating the `prod` GitHub Environment **with required reviewers**, and the prod-scoped OIDC role. Note that `deploy-site-prod.yml` already references that environment and currently gets an unprotected auto-created one, so this closes a gate that today only appears to exist.
3. **Rollback**: re-run the previous release's workflow run. State plainly that this reverts the **image**, not the **schema** — the circuit breaker restores the last good task set while a migration stays applied, which is why migrations must remain backward-compatible with the previous image and why the pre-migration snapshot exists.
4. Lint + format (markdown is not Prettier-formatted).

**Done when:** an operator can cut a release, recognize the first-deploy path, and roll back — without reading this plan or the spec.

**Risk:** none in-repo. The GitHub Environment is a settings change no test can assert; the smoke checklist has to carry it.

---

## Sequence summary

| # | Lands | Gating check |
|---|---|---|
| 1 | `database.yml` + `backend.yml` + `cache.yml` params; dev passes the cert | parity case 9 green; three templates validate; **app-dev deploy green after merge** |
| 2 | `deploy-prod.yml` | parity cases 1–8 green |
| 3 | runbook + operator wiring | prose; `/smoke` |

## Cross-slice notes

- **Slice 1 must reach app-dev before prod is ever run.** It is the only slice that can break an existing environment, and `main` — not this branch — is what deploys to dev. In practice that means the epic merges before the first prod release, which is already the epic's shape.
- **Nothing here provisions anything.** Merging this PR creates no AWS resource; the first prod deploy is a published release, gated on #384's values existing.
- **This ticket interleaves with #384**, as the epic records: database stack (slice 2's `deploy-infra`) → #384's `CREATE DATABASE portal_ai` + `db url --write` → backend stack. A prod release run before that bootstrap will fail at the migrate task.
- **Doc surfaces in this PR:** the runbook (slice 3). `docs/AWS_CLI_OPS.md`'s "prod (pending #83)" section and `CLAUDE.md`'s "future `prod`" phrasing belong to **#387** — they describe the whole epic's outcome, not this slice's.
- **[#391](https://github.com/EnterpriseBT/portal-ai/issues/391)**, surfaced by discovery and out of scope here: jobs stranded in `active` after a Redis loss hold entity locks until cancelled by hand, and no reconciliation exists. It affects app-dev today.

## Next step

Implementation begins on this branch once discovery, spec and plan are confirmed — slice 1 first, tests-first, one commit per slice, PR into `epic/prod-environment`.

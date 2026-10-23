# portalops cache phase on a stale cache template — Condensed design (#861)

**Issue:** [EnterpriseBT/portal-ai#861](https://github.com/EnterpriseBT/portal-ai/issues/861) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** `portalops cache phase both --env app-dev` refuses with "has no RedisCutoverPhase parameter", even though #852's release is deployed.
- The deploy runs `aws cloudformation deploy --no-fail-on-empty-changeset` for `cache.yml`.
- #852's cache template adds a parameter, conditions and outputs but, at its `legacy` default, no resource change.
- CloudFormation treats a change set with no resource changes as "no changes" and never applies it, so the deployed template stays the old one.
- `updateStackParams` updates with `UsePreviousTemplate`, so it can't set a parameter that template lacks.

The backend stack isn't affected: every deploy changes its `ImageTag`. Package: `packages/devops-cli`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The update | `packages/devops-cli/src/commands/cache.ts` `updateStackParams` | `UsePreviousTemplate: true`; refuses (exit 9) when an override isn't a deployed parameter |
| Callers | `cachePhase`, `cacheSwitch` (`cache.ts`), `serviceScale` (`service.ts`) | all go through `updateStackParams` |
| Templates | `infra/cloudformation/cache.yml` (~8 KB), `backend.yml` (~31 KB) | both under UpdateStack's 51,200-byte `TemplateBody` limit |

## Decision — apply the repo's template when the deployed one predates the parameter

- **A. Change the deploy so the template always lands** (e.g. a tag that changes on every deploy). This churns the cache resource on every deploy for a one-time problem, and a future resource-neutral change would hit the same trap.
- **B. Document a manual `aws cloudformation deploy`.** The operator has to compose every parameter by hand, and that's exactly the step the CLI exists to own.
- **C. In `updateStackParams`, when an override isn't a deployed parameter, apply the operator's repo checkout of `infra/cloudformation/<kind>.yml` as `TemplateBody`.**
  - This happens only if that template declares the parameter; otherwise it keeps the exit-9 refusal.
  - Every deployed parameter is still sent as `UsePreviousValue`, and the new parameter gets its override.
  - It prints a stderr notice naming the template it applied.
  - It refuses with exit 7 if the template is over 51,200 bytes.

**Chosen: C.** It fixes app-dev and prod the same way, through the step the runbook already names. The repo template is the one `main` deploys, and the runbook already requires a `main` checkout. The read happens in a small `templates.ts` module (`readRepoTemplate(kind)`, which walks up from the CLI to the repo's `infra/cloudformation/`), so the tests mock it.

## Plan — 1 slice

**Files**
- New: `packages/devops-cli/src/templates.ts` — `readRepoTemplate(kind)` returns `{ path, body }`, or `null` when the CLI can't find a repo.
- Edit: `packages/devops-cli/src/commands/cache.ts` — `updateStackParams` takes the `TemplateBody` path when a parameter is missing from the deployed template.
- Edit: `packages/devops-cli/COMMANDS.md` (cache section) and `docs/REDIS_ENCRYPTION_CUTOVER.runbook.md` (Provision): one note each.

**Tests** — `packages/devops-cli/src/__tests__/cache.test.ts`, run with `npm run test:unit` from `packages/devops-cli`:
- deployed template lacks the parameter and the repo template declares it → UpdateStack uses `TemplateBody` (not `UsePreviousTemplate`), the other parameters are `UsePreviousValue`, the override is set, and a notice is printed;
- the repo template lacks it too → exit 9, no update;
- no repo checkout found → exit 9 with "run from a repo checkout";
- a template over 51,200 bytes → exit 7, no update;
- the parameter is already deployed → unchanged, `UsePreviousTemplate`.

## Smoke (manual, against app-dev)

1. On `main` after merge: `npm run build --workspace @portalai/devops-cli`, then `npx portalops cache phase both --env app-dev --yes --json`. The notice names `infra/cloudformation/cache.yml`; after 10–20 min it prints `{"phase":"both","changed":true}`.
2. `npx portalops cache status --env app-dev --json` shows `phase: both`, the `-tls` group `available` with both encryption flags on and `transitEncryptionMode: "required"`, and the legacy cluster still present.
3. `aws cloudformation describe-stacks --stack-name portalai-dev-cache --query "Stacks[0].Parameters"` lists `RedisCutoverPhase=both`, and every other parameter keeps its previous value.
4. Resume `docs/ELASTICACHE_ENCRYPTION.smoke.md` §3 onward.

## Out of scope

- Changing how the deploy workflows apply resource-neutral template changes in general.
- Refreshing the backend stack's template: its `ImageTag` changes on every deploy, so it never goes stale.

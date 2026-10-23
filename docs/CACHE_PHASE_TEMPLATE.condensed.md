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

## Decision — an explicit, previewed `cache refresh-template`

- **A. Change the deploy so the template always lands** (e.g. a tag that changes on every deploy). This churns the cache resource on every deploy for a one-time problem.
- **B. A fallback inside `updateStackParams`** that applies the repo template whenever a parameter is missing. I built this first, and the code review rejected it. Every cutover command (`phase`, `switch`, `service scale`, and on `backend.yml` too) could then apply whatever template sits in the operator's working tree: no preview, no check that it's `main`, the destructive guard blind to replacements, and a regex for parameter parsing.
- **C. A separate `portalops cache refresh-template`** (cache stack only):
  - it refuses unless the checkout is clean and `HEAD` is `origin/main`;
  - it parses the template with `yaml`;
  - it sends exactly the declared parameters the stack has, each as `UsePreviousValue`, and a new one must have a default;
  - it previews with a change set (deleted after), and counts a resource removal or replacement as destructive, so prod refuses it;
  - it applies with `UpdateStack`, since a template-only change set can't be executed;
  - it audits the template and the commit;
  - `--dry-run` stops after the preview.

  `cache phase`/`switch` stay parameter-only and point at it.

**Chosen: C.** It's narrow, explicit and reviewable, and it works the same on prod. The runbook's Provision step names it.

## Plan — 1 slice

**Files**
- New: `packages/devops-cli/src/templates.ts` — `readRepoTemplate(kind)` and `repoGitState(path)`.
- Edit: `packages/devops-cli/src/commands/cache.ts` — `cacheRefreshTemplate`, and `updateStackParams`'s refusal now names it.
- Edit: `packages/devops-cli/src/bin.ts` — `cache refresh-template`.
- Edit: `packages/devops-cli/package.json` — `yaml` moves to `dependencies`.
- Edit: `COMMANDS.md` and the cutover runbook.

**Tests** — `packages/devops-cli/src/__tests__/cache.test.ts` and `bin.test.ts`, with `npm run test:unit`:
- the preview, then the apply with previous values;
- a replacement counted as destructive (prod refuses);
- `--dry-run` applies nothing;
- refusal on a dirty or non-`main` checkout, outside a checkout, and for a no-default new parameter;
- already current → unchanged;
- `phase` points at `refresh-template`;
- the command is wired.

## Smoke (manual, against app-dev)

1. On a clean, up-to-date `main` after merge: `npm run build --workspace @portalai/devops-cli`, then `npx portalops cache refresh-template --env app-dev --dry-run --json`. Expect `resourceChanges: []`.
2. The same with `--yes`. Expect `changed: true`, and `aws cloudformation describe-stacks --stack-name portalai-dev-cache --query "Stacks[0].Parameters"` now lists `RedisCutoverPhase=legacy`, with every other parameter unchanged.
3. `npx portalops cache phase both --env app-dev --yes --json`. After 10–20 min it prints `{"phase":"both","changed":true}`, and `cache status` shows the `-tls` group `available` with both encryption flags and `required`.
4. Resume `docs/ELASTICACHE_ENCRYPTION.smoke.md` §3 onward.

## Out of scope

- Changing how the deploy workflows apply resource-neutral template changes in general.
- Refreshing the backend stack's template: its `ImageTag` changes on every deploy, so it never goes stale.

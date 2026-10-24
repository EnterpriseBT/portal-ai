# cache refresh-template waits on a change set that's gone — Condensed design (#864)

**Issue:** [EnterpriseBT/portal-ai#864](https://github.com/EnterpriseBT/portal-ai/issues/864) · Bug · **small / condensed** (discovery + spec + plan + smoke in one doc).

**Why.** During the #852 walk, `portalops cache refresh-template --env app-dev --phase both --yes` exited 1 seconds after executing its change set, while the stack update went on to `UPDATE_COMPLETE`.
- After `ExecuteChangeSet` it polled that change set's `ExecutionStatus`.
- CloudFormation removes a stack's change sets once one executes (`list-change-sets` was `[]`), so the describe threw.
- #863's test fake kept the change set, so CI passed.

Package: `packages/devops-cli`.

## Current shape

| Piece | Location | Note |
|---|---|---|
| The wait | `packages/devops-cli/src/commands/cache.ts` `cacheRefreshTemplate` | polled `DescribeChangeSet` → `ExecutionStatus` after execute |
| The fake | `packages/devops-cli/src/__tests__/cache.test.ts` | kept the change set after execute, unlike CloudFormation |

## Decision — wait on the stack

- **A. The SDK's `waitUntilStackUpdateComplete`.** Its first poll can see the *previous* `UPDATE_COMPLETE`, because the asynchronous execute may not have started the update yet. That's the false success #863's review flagged.
- **B. Poll `DescribeStacks` against a baseline.** Record `LastUpdatedTime` before executing, then treat the update as finished only once `LastUpdatedTime` has moved past it and the status no longer ends in `_IN_PROGRESS`. Succeed only on `UPDATE_COMPLETE`; any other settled status (rollback, failure) is an error that names it, and nothing is audited.

**Chosen: B.** It's correct whether the update has started yet or not, and it reads only the stack, which outlives the change set.

## Plan — 1 slice

**Files:** edit `packages/devops-cli/src/commands/cache.ts` (the wait) and `packages/devops-cli/src/__tests__/cache.test.ts`. The fake now removes change sets on execute and plays a stack-status timeline through `DescribeStacks`.

**Tests** (`npm run test:unit` in `packages/devops-cli`):
- success through `UPDATE_IN_PROGRESS` → `UPDATE_COMPLETE`, audited;
- a stale first `UPDATE_COMPLETE` (the update not started) isn't taken for this update's;
- `UPDATE_ROLLBACK_COMPLETE` fails, unaudited.

## Smoke (manual)

1. The next real use: prod's Provision step, `npx portalops cache refresh-template --env prod --phase both --yes --confirm-prod --json` from a clean `main`, exits 0 after the 10–20 min update with `{"changed":true}`, and `~/.portalai/audit.log` gains a `cache refresh-template` line. app-dev is already past this step, so there's no app-dev walk. The unit fake reproduces the failure the app-dev run hit, and the cases above pin the fix.

## Out of scope

- The other cutover commands. `cache switch` and `service scale` start with `UpdateStack`, which is synchronous to start, and wait with the SDK waiter; the walk proved them on app-dev.
